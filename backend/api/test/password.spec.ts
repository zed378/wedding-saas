import { describe, it, expect, vi, beforeEach } from "vitest";
import argon2 from "argon2";

import {
  ARGON2_PARAMS,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkBreached,
  checkPasswordPolicy,
  hashPassword,
  needsRehash,
  resetDummyHashForTests,
  sha1Parts,
  verifyPassword,
} from "../src/modules/auth/password";

/**
 * P1-01 — password hashing and policy.
 *
 * These are slow by design: every hash costs ~277 ms on the deployment host and rather
 * more here. That cost IS the feature, so the suite pays it rather than dropping the
 * parameters for tests -- a timing test against cheap parameters proves nothing about
 * the expensive ones that actually ship.
 */

const PASSWORD = "correct horse battery staple";

describe("hashPassword", () => {
  it("produces an argon2id hash carrying the configured parameters", async () => {
    const hash = await hashPassword(PASSWORD);

    // The whole point of P1-01 step 2 is that these numbers are deliberate. Asserting
    // the encoded string means a change to ARGON2_PARAMS cannot pass unnoticed.
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,p=1,t=3\$/);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const [a, b] = await Promise.all([
      hashPassword(PASSWORD),
      hashPassword(PASSWORD),
    ]);
    expect(a).not.toBe(b);
  });

  it("fits the varchar(255) column docs/DATABASE/02 defines", async () => {
    // Checked rather than assumed. A hash that does not fit is a registration that
    // fails at the INSERT, after the expensive part.
    const hash = await hashPassword("a".repeat(MAX_PASSWORD_LENGTH));
    expect(hash.length).toBeLessThanOrEqual(255);
  });

  it("never contains the plaintext", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).not.toContain(PASSWORD);
    expect(hash).not.toContain("correct");
  });
});

describe("verifyPassword", () => {
  it("accepts the right password and rejects the wrong one", async () => {
    const hash = await hashPassword(PASSWORD);

    await expect(verifyPassword(hash, PASSWORD)).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong password entirely")).resolves.toBe(
      false,
    );
  });

  it("is exact: a one-character difference fails", async () => {
    const hash = await hashPassword(PASSWORD);
    await expect(verifyPassword(hash, PASSWORD + " ")).resolves.toBe(false);
  });

  it("a null hash never verifies", async () => {
    // A Google account has no password (P0-07). The call site that forgets this is the
    // one that logs somebody in without a credential.
    //
    // NOTE: this test does NOT protect the null guard in verifyPassword. Measured by
    // mutation: delete the guard and this still passes, because argon2.verify(null, …)
    // throws and the catch returns false anyway. The guard is there for TIMING, and the
    // two timing tests below are what actually hold it in place.
    await expect(verifyPassword(null, PASSWORD)).resolves.toBe(false);
    await expect(verifyPassword(undefined, PASSWORD)).resolves.toBe(false);
    await expect(verifyPassword("", PASSWORD)).resolves.toBe(false);
  });

  it("returns false rather than throwing on a corrupt hash", async () => {
    // A truncated column must not become a 500 on the login path, and must certainly
    // not become an authentication bypass.
    for (const bad of [
      "not a hash at all",
      "$argon2id$v=19$m=65536,p=1,t=3$truncated",
      "$2b$12$abcdefghijklmnopqrstuv", // a bcrypt-shaped string: the documented fallback
    ]) {
      await expect(verifyPassword(bad, PASSWORD)).resolves.toBe(false);
    }
  });
});

describe("timing equality (docs/SECURITY/03 § Login Rate Limiting)", () => {
  beforeEach(() => {
    resetDummyHashForTests();
  });

  it("does comparable work for an unknown user as for a wrong password", async () => {
    const hash = await hashPassword(PASSWORD);

    // Warm both paths first. The dummy hash is computed lazily, and charging its
    // one-off cost to the first measured iteration would make the unknown-user path
    // look enormously slower for a reason that has nothing to do with the comparison.
    await verifyPassword(hash, "warm up");
    await verifyPassword(null, "warm up");

    const measure = async (h: string | null): Promise<number> => {
      const started = process.hrtime.bigint();
      await verifyPassword(h, "some attempted password");
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    const RUNS = 6;
    const known: number[] = [];
    const unknown: number[] = [];

    // Interleaved, not one batch then the other, so a machine that gets busy halfway
    // through skews both series equally instead of one.
    for (let i = 0; i < RUNS; i += 1) {
      known.push(await measure(hash));
      unknown.push(await measure(null));
    }

    const median = (xs: number[]) =>
      [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

    const a = median(known);
    const b = median(unknown);
    const ratio = Math.max(a, b) / Math.min(a, b);

    // A ratio, not a difference: the absolute cost varies hugely between a laptop and
    // CI, but the two paths should stay proportional on either. The tolerance is loose
    // because this is a shared, non-realtime machine -- what it catches is the real
    // failure, which is one path returning in microseconds because it short-circuited.
    expect(
      ratio,
      `wrong-password median ${a.toFixed(1)}ms vs unknown-user median ${b.toFixed(1)}ms`,
    ).toBeLessThan(1.5);
  });

  it("would fail if the null path short-circuited", async () => {
    // The mutation, made explicit. A `return false` with no work is what this guards
    // against, and it is what the code looked like before the dummy hash existed.
    const started = process.hrtime.bigint();
    await verifyPassword(null, PASSWORD);
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;

    // An argon2 verification at 64 MiB cannot complete in under 10 ms on any hardware
    // this runs on; a short-circuit completes in well under one.
    expect(elapsed).toBeGreaterThan(10);
  });
});

describe("needsRehash", () => {
  it("is false for a hash made with the current parameters", async () => {
    expect(needsRehash(await hashPassword(PASSWORD))).toBe(false);
  });

  it("is true for a hash made with weaker parameters", async () => {
    const weak = await argon2.hash(PASSWORD, {
      ...ARGON2_PARAMS,
      memoryCost: 32768,
      timeCost: 2,
    });
    expect(needsRehash(weak)).toBe(true);
  });

  it("is true for something it cannot parse", () => {
    expect(needsRehash("garbage")).toBe(true);
  });
});

describe("the password policy (docs/SECURITY/03 § Password)", () => {
  const rules = async (password: string, context = {}): Promise<string[]> =>
    (
      await checkPasswordPolicy(password, context, { skipBreachCheck: true })
    ).map((v) => v.rule);

  it("rejects a password below the minimum", async () => {
    expect(await rules("short1")).toContain("too_short");
  });

  it("accepts exactly the minimum", async () => {
    expect(await rules("a".repeat(MIN_PASSWORD_LENGTH))).toEqual([]);
  });

  it("accepts a long passphrase", async () => {
    // docs/SECURITY/03: "No overly strict maximum length (allow long passphrases)."
    const passphrase =
      "the quick brown fox jumps over the lazy dog and keeps on running";
    expect(passphrase.length).toBeGreaterThan(60);
    expect(await rules(passphrase)).toEqual([]);
  });

  it("rejects an absurdly long password", async () => {
    // Not a policy rule but a bound: argon2's cost is independent of input length, so
    // without one a ten-megabyte body is hashed as cheaply as a short password.
    expect(await rules("a".repeat(MAX_PASSWORD_LENGTH + 1))).toContain(
      "too_long",
    );
  });

  it("counts characters, not UTF-16 units", async () => {
    // Eight emoji are eight characters to a user and sixteen to String.length. Telling
    // someone their eight-character password is too short would be wrong and baffling.
    expect(await rules("😀".repeat(8))).toEqual([]);
    expect(await rules("😀".repeat(7))).toContain("too_short");
  });

  it("preserves leading and trailing spaces rather than trimming", async () => {
    // A trimmed password is one that works at registration and fails at login.
    const padded = "  spaced out  ";
    const hash = await hashPassword(padded);
    await expect(verifyPassword(hash, padded)).resolves.toBe(true);
    await expect(verifyPassword(hash, padded.trim())).resolves.toBe(false);
  });

  it("rejects a password that is the user's own name", async () => {
    expect(await rules("budisantoso", { fullName: "Budi Santoso" })).toContain(
      "resembles_identity",
    );
    expect(
      await rules("Budi-Santoso!", { fullName: "Budi Santoso" }),
    ).toContain("resembles_identity");
  });

  it("rejects a password that is the email's local part", async () => {
    expect(
      await rules("budisantoso99", { email: "budisantoso@gmail.com" }),
    ).toContain("resembles_identity");
  });

  it("does not reject an unrelated password", async () => {
    expect(
      await rules("kembang-sepatu-ungu", {
        email: "budisantoso@gmail.com",
        fullName: "Budi Santoso",
      }),
    ).toEqual([]);
  });

  it("does not treat a very short identity as a match", async () => {
    // A two-letter name would match almost every password.
    expect(await rules("aliansi-merah-biru", { fullName: "Li" })).toEqual([]);
  });

  it("reports every violation, not just the first", async () => {
    const found = await rules("budi", { fullName: "Budi Santoso" });
    expect(found).toContain("too_short");
    expect(found).toContain("resembles_identity");
  });

  it("never puts the password in a message", async () => {
    const violations = await checkPasswordPolicy(
      "budi",
      { fullName: "Budi Santoso" },
      {
        skipBreachCheck: true,
      },
    );
    for (const v of violations) {
      expect(v.message).not.toContain("budi");
      expect(v.field).toBe("password");
    }
  });
});

describe("the breached-password check", () => {
  const SUFFIX = sha1Parts(PASSWORD).suffix;

  const respond = (body: string, status = 200) =>
    vi.fn(async () => new Response(body, { status }));

  it("sends only the SHA-1 prefix, never the password", async () => {
    // The property the whole k-anonymity scheme rests on, and one careless template
    // literal away from being untrue.
    // Typed as `fetch` so the recorded call arguments are typed too -- an untyped
    // vi.fn() infers a zero-argument signature and indexing its calls is a type error.
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(`${SUFFIX}:5`, { status: 200 }),
    );
    await checkBreached(PASSWORD, { fetch: fetchMock });

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toMatch(/\/[0-9A-F]{5}$/);
    expect(url).not.toContain(PASSWORD);
    expect(url).not.toContain(SUFFIX);
    expect(url).not.toContain("correct");
  });

  it("reports a breached password with its count", async () => {
    const result = await checkBreached(PASSWORD, {
      fetch: respond(`0000000000000000000000000000000000A:1\n${SUFFIX}:4213`),
    });
    expect(result).toEqual({ status: "breached", count: 4213 });
  });

  it("reports a password that is not in the list as safe", async () => {
    const result = await checkBreached(PASSWORD, {
      fetch: respond("0000000000000000000000000000000000A:1"),
    });
    expect(result).toEqual({ status: "safe" });
  });

  it("ignores padding entries, which have a count of zero", async () => {
    const result = await checkBreached(PASSWORD, {
      fetch: respond(`${SUFFIX}:0`),
    });
    expect(result).toEqual({ status: "safe" });
  });

  it("requests padding, so the response size reveals nothing", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(`${SUFFIX}:0`, { status: 200 }),
    );
    await checkBreached(PASSWORD, { fetch: fetchMock });

    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
    expect(headers.get("Add-Padding")).toBe("true");
  });

  it.each([
    [
      "a network failure",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
    ["a 503", async () => new Response("", { status: 503 })],
    [
      "an HTML error page",
      async () => new Response("<html>nope</html>", { status: 200 }),
    ],
  ])("reports %s as unavailable rather than as safe", async (_label, impl) => {
    // ADR-044. Folding these into "safe" would be a control that silently stopped
    // working; the caller has to be able to tell the difference.
    const result = await checkBreached(PASSWORD, {
      fetch: impl as typeof fetch,
    });
    expect(result.status).toBe("unavailable");
  });
});

describe("the breach check's failure mode (ADR-044)", () => {
  it("fails OPEN: an unreachable API accepts the password", async () => {
    const violations = await checkPasswordPolicy(
      "kembang-sepatu-ungu",
      {},
      {
        fetch: (async () => {
          throw new TypeError("fetch failed");
        }) as typeof fetch,
      },
    );
    expect(violations).toEqual([]);
  });

  it("rejects a breached password when the API does answer", async () => {
    const suffix = sha1Parts("password123").suffix;
    const violations = await checkPasswordPolicy(
      "password123",
      {},
      { fetch: (async () => new Response(`${suffix}:12345`)) as typeof fetch },
    );
    expect(violations.map((v) => v.rule)).toEqual(["breached"]);
  });

  it("does not name the breach count in the message", async () => {
    // "Found in 3,861,493 breaches" invites the reader to treat a smaller number as
    // acceptable.
    const suffix = sha1Parts("password123").suffix;
    const [violation] = await checkPasswordPolicy(
      "password123",
      {},
      { fetch: (async () => new Response(`${suffix}:12345`)) as typeof fetch },
    );
    expect(violation!.message).not.toContain("12345");
  });

  it("does not call the API for a password that already failed another rule", async () => {
    // No point asking a third party about a password that cannot be accepted anyway.
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(""));
    await checkPasswordPolicy("short", {}, { fetch: fetchMock });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
