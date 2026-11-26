import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import {
  MfaService,
  base32Decode,
  base32Encode,
  computeTotp,
  verifyTotpCode,
} from "./mfa.service";

describe("MfaService RFC 6238 & Crypto Unit Tests", () => {
  const dummyEnv = {
    JWT_SIGNING_KEY: "test-secret-key-that-is-at-least-32-chars-long",
  } as any;

  const dummyDb = {} as any;
  const mfaService = new MfaService(dummyDb, dummyEnv);

  describe("Base32 encoding & decoding", () => {
    it("round-trips arbitrary buffers correctly", () => {
      const buffer = Buffer.from("Hello, World 2026!");
      const encoded = base32Encode(buffer);
      const decoded = base32Decode(encoded);
      expect(decoded.toString("utf8")).toBe("Hello, World 2026!");
    });

    it("encodes 20 bytes (160 bits) RFC 6238 secrets to 32 base32 chars", () => {
      const buffer = Buffer.alloc(20, 0x42);
      const encoded = base32Encode(buffer);
      expect(encoded.length).toBe(32);
      const decoded = base32Decode(encoded);
      expect(decoded).toEqual(buffer);
    });
  });

  describe("RFC 6238 TOTP computation & drift", () => {
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"; // 32-char Base32

    it("generates a 6-digit numeric string", () => {
      const code = computeTotp(secret, 1700000000, 30);
      expect(code).toMatch(/^\d{6}$/);
    });

    it("verifies code at current timestamp", () => {
      const now = Math.floor(Date.now() / 1000);
      const code = computeTotp(secret, now, 30);
      expect(verifyTotpCode(secret, code, now, 30)).toBe(true);
    });

    it("accepts code with -30s drift (-1 window)", () => {
      const now = 1700000060;
      const prevCode = computeTotp(secret, now - 30, 30);
      expect(verifyTotpCode(secret, prevCode, now, 30)).toBe(true);
    });

    it("accepts code with +30s drift (+1 window)", () => {
      const now = 1700000060;
      const nextCode = computeTotp(secret, now + 30, 30);
      expect(verifyTotpCode(secret, nextCode, now, 30)).toBe(true);
    });

    it("rejects code older than 1 window (-60s drift)", () => {
      const now = 1700000090;
      const oldCode = computeTotp(secret, now - 60, 30);
      expect(verifyTotpCode(secret, oldCode, now, 30)).toBe(false);
    });

    it("rejects code newer than 1 window (+60s drift)", () => {
      const now = 1700000090;
      const futureCode = computeTotp(secret, now + 60, 30);
      expect(verifyTotpCode(secret, futureCode, now, 30)).toBe(false);
    });

    it("rejects wrong or non-numeric codes", () => {
      const now = 1700000000;
      expect(verifyTotpCode(secret, "000000", now, 30)).toBe(false);
      expect(verifyTotpCode(secret, "abcdef", now, 30)).toBe(false);
      expect(verifyTotpCode(secret, "12345", now, 30)).toBe(false);
    });
  });

  describe("AES-256-GCM secret encryption at rest", () => {
    it("encrypts and decrypts secret cleanly", () => {
      const secret = "MZXW6YTBOI======";
      const encrypted = mfaService.encryptSecret(secret);
      expect(Buffer.isBuffer(encrypted)).toBe(true);
      expect(encrypted.length).toBeGreaterThan(28); // 12 IV + 16 Tag + ciphertext

      const decrypted = mfaService.decryptSecret(encrypted);
      expect(decrypted).toBe(secret);
    });

    it("fails decryption if ciphertext or auth tag is tampered", () => {
      const secret = "MZXW6YTBOI======";
      const encrypted = mfaService.encryptSecret(secret);
      encrypted[20] = (encrypted[20] ?? 0) ^ 0xff; // tamper auth tag

      expect(() => mfaService.decryptSecret(encrypted)).toThrow();
    });
  });

  describe("Recovery codes", () => {
    it("generates 8 single-use recovery codes in XXXX-XXXX format", () => {
      const codes = mfaService.generateRecoveryCodes();
      expect(codes).toHaveLength(8);
      for (const code of codes) {
        expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
      }
      const unique = new Set(codes);
      expect(unique.size).toBe(8);
    });

    it("hashes recovery code consistently with sha256", () => {
      const code = "ABCD-1234";
      const hash1 = mfaService.hashRecoveryCode(code);
      const hash2 = mfaService.hashRecoveryCode("abcd-1234 ");
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });
  });

  describe("MFA Tickets and Step-Up Tokens", () => {
    it("signs and verifies an MFA challenge ticket", async () => {
      const ticket = await mfaService.signMfaTicket(
        "user-1",
        "admin@vizunicum.test",
        "admin",
        "challenge",
      );
      const verified = await mfaService.verifyMfaTicket(ticket, "challenge");
      expect(verified.userId).toBe("user-1");
      expect(verified.email).toBe("admin@vizunicum.test");
      expect(verified.role).toBe("admin");
    });

    it("rejects MFA ticket with mismatched purpose", async () => {
      const ticket = await mfaService.signMfaTicket(
        "user-1",
        "admin@vizunicum.test",
        "admin",
        "setup",
      );
      await expect(
        mfaService.verifyMfaTicket(ticket, "challenge"),
      ).rejects.toThrow();
    });

    it("signs and verifies a 10-minute step-up re-authentication token", async () => {
      const token = await mfaService.signStepUpToken("admin-99", "admin");
      const ok = await mfaService.verifyStepUpToken(token, "admin-99");
      expect(ok).toBe(true);

      const invalidUser = await mfaService.verifyStepUpToken(
        token,
        "admin-100",
      );
      expect(invalidUser).toBe(false);
    });
  });
});

describe("MfaService enrollment and challenge boundaries", () => {
  const env = {
    JWT_SIGNING_KEY: "test-secret-key-that-is-at-least-32-chars-long",
  } as any;
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

  function harness(results: unknown[][] = []) {
    const pending = [...results];
    const select = vi.fn(() => {
      const rows = pending.shift() ?? [];
      const query: Record<string, unknown> = {};
      for (const method of ["from", "where", "orderBy", "limit"]) {
        query[method] = vi.fn(() => query);
      }
      // Model the awaitable Drizzle query without depending on a live database.
      // oxlint-disable-next-line unicorn/no-thenable
      query.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve);
      return query;
    });
    const writes = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
      values: vi.fn().mockResolvedValue(undefined),
    };
    const db = {
      select,
      update: vi.fn(() => writes),
      delete: vi.fn(() => writes),
      insert: vi.fn(() => writes),
    };
    const service = new MfaService(db as never, env);
    const factor = {
      id: "factor-1",
      secretEncrypted: service.encryptSecret(secret),
      confirmedAt: new Date("2026-11-26T00:00:00Z"),
    };
    return { service, db, writes, factor };
  }

  afterEach(() => vi.useRealTimers());

  it("distinguishes missing, unconfirmed and confirmed enrollment", async () => {
    for (const [rows, expected] of [
      [[], false],
      [[{ id: "factor-1", confirmedAt: null }], false],
      [[{ id: "factor-1", confirmedAt: new Date() }], true],
    ] as const) {
      const { service } = harness([[], [...rows]]);
      await expect(service.hasConfirmedFactor("admin-1")).resolves.toBe(
        expected,
      );
    }
  });

  it("stores an encrypted unconfirmed setup and returns a scannable URI with encoded email", async () => {
    const { service, db, writes } = harness();
    const result = await service.setupTotp(
      "admin-1",
      "support+admin@example.test",
    );
    expect(result.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(result.qrUri).toContain("support%2Badmin%40example.test");
    expect(result.qrUri).toContain(`secret=${result.secret}`);
    expect(result.recoveryCodes).toHaveLength(8);
    expect(db.delete).toHaveBeenCalledOnce();
    expect(writes.values).toHaveBeenCalledWith({
      userId: "admin-1",
      type: "totp",
      secretEncrypted: expect.any(Buffer),
      label: "Authenticator App",
      confirmedAt: null,
    });
    const stored = writes.values.mock.calls[0]![0].secretEncrypted;
    expect(service.decryptSecret(stored)).toBe(result.secret);
  });

  it("refuses absent enrollment or an invalid first code without confirming factors", async () => {
    const absent = harness([[]]);
    await expect(
      absent.service.confirmTotp("admin-1", "123456", []),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(absent.db.update).not.toHaveBeenCalled();

    const invalid = harness();
    invalid.db.select.mockImplementationOnce(() => {
      const other = harness([[invalid.factor]]);
      return other.db.select();
    });
    await expect(
      invalid.service.confirmTotp("admin-1", "bad-code", []),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(invalid.db.update).not.toHaveBeenCalled();
    expect(invalid.db.insert).not.toHaveBeenCalled();
  });

  it("confirms a valid setup and persists only hashed replacement recovery codes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-26T00:00:00Z"));
    const { service, db, writes, factor } = harness();
    const query = harness([[factor]]);
    db.select.mockImplementationOnce(query.db.select);
    const code = computeTotp(secret, Math.floor(Date.now() / 1000));
    await expect(
      service.confirmTotp("admin-1", ` ${code} `, ["ABCD-1234", "5678-EFAB"]),
    ).resolves.toBe(true);
    expect(writes.set).toHaveBeenCalledWith({
      confirmedAt: new Date(),
      lastUsedAt: new Date(),
    });
    expect(db.delete).toHaveBeenCalledOnce();
    expect(writes.values).toHaveBeenNthCalledWith(1, {
      userId: "admin-1",
      codeHash: service.hashRecoveryCode("ABCD-1234"),
      usedAt: null,
    });
    expect(writes.values).toHaveBeenNthCalledWith(2, {
      userId: "admin-1",
      codeHash: service.hashRecoveryCode("5678-EFAB"),
      usedAt: null,
    });
  });

  it("rejects empty challenges and missing or unconfirmed factors without writes", async () => {
    for (const candidate of [
      {},
      { code: "bad-code" },
      { recoveryCode: "not-found" },
    ]) {
      const { service, db } = harness([[]]);
      await expect(
        service.verifyCodeOrRecovery("admin-1", candidate),
      ).resolves.toEqual({ success: false, usedRecoveryCode: false });
      expect(db.update).not.toHaveBeenCalled();
    }
    const unconfirmed = harness([[{ confirmedAt: null }]]);
    await expect(
      unconfirmed.service.verifyCodeOrRecovery("admin-1", { code: "123456" }),
    ).resolves.toEqual({ success: false, usedRecoveryCode: false });
    expect(unconfirmed.db.update).not.toHaveBeenCalled();
  });

  it("records last use for valid TOTP and does not consume a supplied recovery code", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-26T00:00:00Z"));
    const { service, db, writes, factor } = harness();
    db.select.mockImplementationOnce(harness([[factor]]).db.select);
    const code = computeTotp(secret, Math.floor(Date.now() / 1000));
    await expect(
      service.verifyCodeOrRecovery("admin-1", {
        code: ` ${code} `,
        recoveryCode: "ABCD-1234",
      }),
    ).resolves.toEqual({ success: true, usedRecoveryCode: false });
    expect(writes.set).toHaveBeenCalledWith({ lastUsedAt: new Date() });
    expect(db.select).toHaveBeenCalledOnce();
  });

  it("falls back from invalid TOTP to an unused recovery code and marks it consumed", async () => {
    const { service, db, writes, factor } = harness();
    db.select.mockImplementation(
      harness([[factor], [{ id: "recovery-1" }]]).db.select,
    );
    await expect(
      service.verifyCodeOrRecovery("admin-1", {
        code: "invalid",
        recoveryCode: " abcd-1234 ",
      }),
    ).resolves.toEqual({ success: true, usedRecoveryCode: true });
    expect(writes.set).toHaveBeenCalledWith({ usedAt: expect.any(Date) });
    expect(db.update).toHaveBeenCalledOnce();
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("rejects truncated encrypted secrets", () => {
    expect(() => harness().service.decryptSecret(Buffer.alloc(27))).toThrow(
      "Invalid encrypted secret payload",
    );
  });

  it("rejects expired MFA and step-up credentials and forged token text", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-26T00:00:00Z"));
    const { service } = harness();
    const ticket = await service.signMfaTicket(
      "admin-1",
      "admin@example.test",
      "admin",
      "challenge",
    );
    const stepUp = await service.signStepUpToken("admin-1", "admin");
    vi.advanceTimersByTime(11 * 60 * 1000);
    await expect(
      service.verifyMfaTicket(ticket, "challenge"),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(service.verifyStepUpToken(stepUp, "admin-1")).resolves.toBe(
      false,
    );
    await expect(
      service.verifyStepUpToken("not.a.jwt", "admin-1"),
    ).resolves.toBe(false);
  });

  it("rejects correctly signed step-up tokens carrying the wrong purpose", async () => {
    const key = new TextEncoder().encode(env.JWT_SIGNING_KEY);
    const token = await new SignJWT({ purpose: "challenge" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("admin-1")
      .setIssuer("wedding-invitation")
      .setAudience("wedding-invitation-stepup")
      .setExpirationTime("10m")
      .sign(key);
    await expect(
      harness().service.verifyStepUpToken(token, "admin-1"),
    ).resolves.toBe(false);
  });
});
