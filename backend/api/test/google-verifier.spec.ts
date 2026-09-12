import { describe, expect, it, vi, afterEach } from "vitest";
import { OAuth2Client } from "google-auth-library";

import {
  createGoogleTokenVerifier,
  GoogleUnavailableError,
  InvalidGoogleTokenError,
} from "../src/modules/auth/oauth/google-verifier";
import { rejection } from "./support/rejection";

/**
 * P1-04 — the `id_token` verifier.
 *
 * `verifyIdToken` itself is Google's code and is not re-tested here; a test that asserts
 * "an RS256 signature over Google's JWKS is checked" would be testing the library. What
 * IS tested is everything this wrapper adds, and all of it is a decision that could be
 * made wrong:
 *
 *  - that the audience is passed at all, which is the check people skip;
 *  - that a rejected token and an unreachable Google become DIFFERENT errors;
 *  - that an unrecognised failure is treated as unavailable rather than as a rejection --
 *    the fail-safe direction, since the classification is message-based and therefore
 *    fragile;
 *  - that `email_verified` absent does not read as verified.
 */

const CLIENT_ID = "1234567890-abcdef.apps.googleusercontent.com";

/** Stand in for the network call, so nothing here touches Google. */
function stubVerifyIdToken(
  impl: (options: { idToken: string; audience?: unknown }) => unknown,
) {
  return vi
    .spyOn(OAuth2Client.prototype, "verifyIdToken")
    .mockImplementation(impl as never);
}

const payload = (over: Record<string, unknown> = {}) => ({
  getPayload: () => ({
    sub: "google-subject-1234567890",
    email: "Budi@Example.Test",
    email_verified: true,
    name: "Budi Santoso",
    ...over,
  }),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the audience is checked", () => {
  it("passes our client id as the audience", async () => {
    // THE check. A token minted for a different Google application is validly signed and
    // carries a real verified email; without this argument it would verify here, and any
    // site using Google Sign-In could hand us its users' tokens.
    const spy = stubVerifyIdToken(() => payload());

    await createGoogleTokenVerifier(CLIENT_ID).verify("a-token");

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ audience: CLIENT_ID }),
    );
  });

  it("a token for another audience is refused", async () => {
    // What the library does when the audience does not match.
    stubVerifyIdToken(() => {
      throw new Error("Wrong recipient, payload audience != requiredAudience");
    });

    await expect(
      createGoogleTokenVerifier(CLIENT_ID).verify("a-token"),
    ).rejects.toBeInstanceOf(InvalidGoogleTokenError);
  });
});

describe("rejections are 401-shaped", () => {
  it.each([
    ["a bad signature", "Invalid token signature: abc"],
    ["an expired token", "Token used too late, 1/2: exp"],
    ["a token used too early", "Token used too early, 1/2"],
    ["an unknown signing key", "No pem found for envelope"],
    ["a malformed token", "Wrong number of segments in token: abc"],
    ["a wrong issuer", "Invalid issuer, expected one of ..."],
  ])("%s is an InvalidGoogleTokenError", async (_name, message) => {
    stubVerifyIdToken(() => {
      throw new Error(message);
    });

    await expect(
      createGoogleTokenVerifier(CLIENT_ID).verify("a-token"),
    ).rejects.toBeInstanceOf(InvalidGoogleTokenError);
  });

  it("never carries the token out of the library, in message OR reason", async () => {
    // google-auth-library throws `new Error('Invalid token signature: ' + jwt)` -- the
    // whole token, in the message. `reason` is logged, so forwarding the message would
    // put a live bearer credential in the log stream. Redaction works on key names and
    // could not have caught it: the value would have arrived inside a string called
    // `reason`.
    stubVerifyIdToken(() => {
      throw new Error("Invalid token signature: the-secret-token-value");
    });

    const error = await rejection<InvalidGoogleTokenError>(() =>
      createGoogleTokenVerifier(CLIENT_ID).verify("the-secret-token-value"),
    );

    expect(error.message).not.toContain("the-secret-token-value");
    expect(error.reason).not.toContain("the-secret-token-value");
    expect(error.reason).toBe("bad_signature");
  });

  it("never carries an email out of the library either", async () => {
    // `No issue time in token: ` + JSON.stringify(payload) -- the payload contains the
    // user's address. docs/SECURITY/09 keeps addresses out of logs.
    stubVerifyIdToken(() => {
      throw new Error(
        'No issue time in token: {"email":"budi@example.test","sub":"1"}',
      );
    });

    const error = await rejection<InvalidGoogleTokenError>(() =>
      createGoogleTokenVerifier(CLIENT_ID).verify("t"),
    );

    expect(error.reason).toBe("missing_time_claim");
    expect(JSON.stringify(error)).not.toContain("budi@example.test");
  });
});

describe("unavailability is 503-shaped, and is the default", () => {
  it.each([
    ["a DNS failure", "getaddrinfo ENOTFOUND www.googleapis.com"],
    ["a timeout", "ETIMEDOUT"],
    ["a 500 from Google", "Request failed with status code 500"],
    ["a wording nobody predicted", "something entirely new happened"],
  ])("%s is a GoogleUnavailableError", async (_name, message) => {
    stubVerifyIdToken(() => {
      throw new Error(message);
    });

    await expect(
      createGoogleTokenVerifier(CLIENT_ID).verify("a-token"),
    ).rejects.toBeInstanceOf(GoogleUnavailableError);
  });

  it("an unrecognised failure fails SAFE, not open", async () => {
    // The classification is message-based and therefore fragile. It is biased so that a
    // library wording change makes sign-in report a 503 for a while, rather than quietly
    // starting to accept something it should not. This test is the bias, written down.
    stubVerifyIdToken(() => {
      throw new Error("a message this file has never seen");
    });

    const error = await rejection<unknown>(() =>
      createGoogleTokenVerifier(CLIENT_ID).verify("a-token"),
    );

    expect(error).toBeInstanceOf(GoogleUnavailableError);
    expect(error).not.toBeInstanceOf(InvalidGoogleTokenError);
  });

  it("a missing client id is unavailable, and names the variable", async () => {
    // Not a 401: the user did nothing wrong. An operator reading "sign-in failed" would
    // have no reason to look at an environment variable.
    const error = await rejection<Error>(() =>
      createGoogleTokenVerifier(undefined).verify("a-token"),
    );

    expect(error).toBeInstanceOf(GoogleUnavailableError);
    expect((error.cause as Error).message).toContain("GOOGLE_OAUTH_CLIENT_ID");
  });
});

describe("the identity it returns", () => {
  it("lowercases the email", async () => {
    // Budi@Example.Test and budi@example.test are one mailbox, and the unique email index
    // is case-sensitive.
    stubVerifyIdToken(() => payload());

    const identity = await createGoogleTokenVerifier(CLIENT_ID).verify("t");
    expect(identity.email).toBe("budi@example.test");
  });

  it.each([
    ["absent", undefined],
    ["the string 'true'", "true"],
    ["the number 1", 1],
    ["false", false],
  ])("email_verified %s does not read as verified", async (_name, value) => {
    // Strictly `=== true`. A truthy check would accept the string "false".
    stubVerifyIdToken(() => payload({ email_verified: value }));

    const identity = await createGoogleTokenVerifier(CLIENT_ID).verify("t");
    expect(identity.emailVerified).toBe(false);
  });

  it("reports a missing name as undefined rather than an empty string", async () => {
    stubVerifyIdToken(() => payload({ name: "" }));

    const identity = await createGoogleTokenVerifier(CLIENT_ID).verify("t");
    expect(identity.name).toBeUndefined();
  });

  it.each([
    ["no payload at all", null],
    ["no subject", { sub: undefined }],
    ["an empty subject", { sub: "" }],
    ["no email", { email: undefined }],
  ])("refuses a verified token with %s", async (_name, over) => {
    // A signed Google token without these should not exist. If one does, the safe reading
    // is that it is not the token we think it is.
    stubVerifyIdToken(() =>
      over === null ? { getPayload: () => undefined } : payload(over),
    );

    await expect(
      createGoogleTokenVerifier(CLIENT_ID).verify("t"),
    ).rejects.toBeInstanceOf(InvalidGoogleTokenError);
  });
});
