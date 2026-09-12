import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ACCESS_TOKEN_TTL_SECONDS,
  InvalidAccessTokenError,
  signAccessToken,
  verifyAccessToken,
} from "../src/modules/auth/tokens/access-token.service";

/**
 * P1-03 — the access token.
 *
 * Most of this file is negative. Signing and verifying a token I just signed proves
 * almost nothing; what matters is the set of things that must NOT verify, and every one
 * of them is a published attack on JWT rather than a hypothetical.
 */

const KEY = "a-test-signing-key-of-sufficient-length-0000";
const OTHER_KEY = "a-different-signing-key-of-sufficient-len-11";

const claims = {
  userId: "11111111-1111-4111-8111-111111111111",
  role: "user",
  emailVerified: true,
};

/** Build a token by hand, so the header can be anything. */
function forge(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  key: string | null,
): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o), "utf8").toString("base64url");

  const signingInput = `${b64(header)}.${b64(payload)}`;
  const signature =
    key === null
      ? ""
      : createHmac("sha256", key).update(signingInput).digest("base64url");

  return `${signingInput}.${signature}`;
}

function validPayload(over: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: claims.userId,
    role: claims.role,
    email_verified: claims.emailVerified,
    iss: "wedding-invitation",
    aud: "wedding-invitation-api",
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    ...over,
  };
}

describe("access token round trip", () => {
  it("carries user id, role and email_verified", async () => {
    const token = await signAccessToken(KEY, claims);
    expect(await verifyAccessToken(KEY, token)).toEqual(claims);
  });

  it("expires in 15 minutes", async () => {
    // docs/API/01 § Token Strategy.
    const now = new Date();
    const token = await signAccessToken(KEY, claims, now);

    const justBefore = new Date(
      now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000 - 2000,
    );
    await expect(verifyAccessToken(KEY, token, justBefore)).resolves.toEqual(
      claims,
    );

    const justAfter = new Date(
      now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000 + 2000,
    );
    await expect(verifyAccessToken(KEY, token, justAfter)).rejects.toThrow(
      InvalidAccessTokenError,
    );
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(900);
  });

  it("refuses a key shorter than 32 characters, on both sides", async () => {
    // A short HMAC key is brute-forceable offline from one captured token, and every
    // forgery afterwards is indistinguishable from a real token.
    await expect(signAccessToken("short", claims)).rejects.toThrow(
      /at least 32/,
    );
    const token = await signAccessToken(KEY, claims);
    await expect(verifyAccessToken("short", token)).rejects.toThrow(
      /at least 32/,
    );
  });
});

describe("forgery", () => {
  it("a token signed with another key is refused", async () => {
    // The abuse case from docs/SECURITY/01 § Elevation of Privilege: an attacker who
    // writes their own `role: admin` token still has to sign it.
    const forged = forge(
      { alg: "HS256", typ: "JWT" },
      validPayload({ role: "super_admin" }),
      OTHER_KEY,
    );

    await expect(verifyAccessToken(KEY, forged)).rejects.toThrow(
      InvalidAccessTokenError,
    );
  });

  it("an unsigned token is refused", async () => {
    // `alg: none`. The oldest JWT attack there is: a verifier that believes the header
    // accepts a token with no signature at all.
    const unsigned = forge({ alg: "none", typ: "JWT" }, validPayload(), null);

    await expect(verifyAccessToken(KEY, unsigned)).rejects.toThrow(
      InvalidAccessTokenError,
    );
  });

  it("a token whose algorithm is not HS256 is refused", async () => {
    // Algorithm substitution. Refused because `algorithms: ["HS256"]` is pinned on
    // verify -- delete that option and this test is what fails.
    const substituted = forge(
      { alg: "HS512", typ: "JWT" },
      validPayload(),
      KEY,
    );

    await expect(verifyAccessToken(KEY, substituted)).rejects.toThrow(
      InvalidAccessTokenError,
    );
  });

  it("a tampered payload is refused", async () => {
    const token = await signAccessToken(KEY, claims);
    const [header, payload, signature] = token.split(".");

    const escalated = Buffer.from(
      JSON.stringify({
        ...(JSON.parse(
          Buffer.from(payload!, "base64url").toString("utf8"),
        ) as object),
        role: "super_admin",
      }),
      "utf8",
    ).toString("base64url");

    await expect(
      verifyAccessToken(KEY, `${header}.${escalated}.${signature}`),
    ).rejects.toThrow(InvalidAccessTokenError);
  });

  it("a token minted for a different service is refused", async () => {
    // `iss`/`aud` are pinned. Not a defence against an attacker -- they can set any
    // issuer they can sign -- but against a second service sharing this secret.
    const wrongIssuer = forge(
      { alg: "HS256", typ: "JWT" },
      validPayload({ iss: "some-other-service" }),
      KEY,
    );

    await expect(verifyAccessToken(KEY, wrongIssuer)).rejects.toThrow(
      InvalidAccessTokenError,
    );
  });

  it.each(["not.a.jwt", "", "a.b", "....", "Bearer something"])(
    "a malformed token (%j) is refused rather than crashing",
    async (garbage) => {
      await expect(verifyAccessToken(KEY, garbage)).rejects.toThrow(
        InvalidAccessTokenError,
      );
    },
  );
});

describe("claims this application requires", () => {
  // Every one of these is validly signed with the right key. `jose` has no opinion on
  // them; without the checks in `verifyAccessToken` they would produce a user with an
  // undefined role, which is not a role anyone reasoned about.
  it.each([
    ["sub", { sub: undefined }],
    ["an empty sub", { sub: "" }],
    ["role", { role: undefined }],
    ["a non-string role", { role: 42 }],
    ["email_verified", { email_verified: undefined }],
    ["a non-boolean email_verified", { email_verified: "yes" }],
  ])("refuses a signed token missing %s", async (_name, over) => {
    const token = forge({ alg: "HS256", typ: "JWT" }, validPayload(over), KEY);

    await expect(verifyAccessToken(KEY, token)).rejects.toThrow(
      InvalidAccessTokenError,
    );
  });
});

describe("the rejection reason never reaches the caller", () => {
  it("every failure is the same error with the same message", async () => {
    const expired = await signAccessToken(
      KEY,
      claims,
      new Date(Date.now() - 3_600_000),
    );
    const forged = forge(
      { alg: "HS256", typ: "JWT" },
      validPayload(),
      OTHER_KEY,
    );

    const errors = await Promise.all(
      [expired, forged, "garbage"].map((t) =>
        verifyAccessToken(KEY, t).catch((e: unknown) => e),
      ),
    );

    // The `reason` differs -- it is for the log. The message a caller could observe does
    // not: "expired" and "forged" must not be distinguishable to whoever presented it.
    const messages = new Set(
      errors.map((e) => (e as InvalidAccessTokenError).message),
    );
    expect(messages.size).toBe(1);
    expect(new Set(errors.map((e) => (e as Error).name))).toEqual(
      new Set(["InvalidAccessTokenError"]),
    );
  });
});
