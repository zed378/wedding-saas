import { describe, expect, it } from "vitest";
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
      const ticket = await mfaService.signMfaTicket("user-1", "admin@vizunicum.test", "admin", "challenge");
      const verified = await mfaService.verifyMfaTicket(ticket, "challenge");
      expect(verified.userId).toBe("user-1");
      expect(verified.email).toBe("admin@vizunicum.test");
      expect(verified.role).toBe("admin");
    });

    it("rejects MFA ticket with mismatched purpose", async () => {
      const ticket = await mfaService.signMfaTicket("user-1", "admin@vizunicum.test", "admin", "setup");
      await expect(mfaService.verifyMfaTicket(ticket, "challenge")).rejects.toThrow();
    });

    it("signs and verifies a 10-minute step-up re-authentication token", async () => {
      const token = await mfaService.signStepUpToken("admin-99", "admin");
      const ok = await mfaService.verifyStepUpToken(token, "admin-99");
      expect(ok).toBe(true);

      const invalidUser = await mfaService.verifyStepUpToken(token, "admin-100");
      expect(invalidUser).toBe(false);
    });
  });
});
