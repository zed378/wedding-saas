import { OAuth2Client, type TokenPayload } from "google-auth-library";

/**
 * P1-04 — verifying a Google `id_token`. `docs/SECURITY/03` § Google OAuth.
 *
 * > "The `id_token` is verified directly with Google (server-side); NEVER trust the email
 * > from the request body."
 *
 * The second half of that sentence is enforced by the controller, which has no `email`
 * field to trust. This file is the first half.
 *
 * ## The three checks, and why none is optional
 *
 * **Signature.** Without it an `id_token` is a base64 JSON object anybody can type.
 *
 * **`aud`.** The one people skip. A token minted for a *different* application is validly
 * signed by Google and carries a real, verified email; accepting it means any website that
 * uses Google Sign-In can hand its users' tokens to us and get sessions. `verifyIdToken`
 * takes the audience as a required argument, which is why this wrapper exists rather than
 * a bare `client.verifyIdToken` at the call site with the option perhaps passed.
 *
 * **`exp`.** A token captured from a log, a proxy, or a browser history would otherwise
 * work forever.
 *
 * `iss` is checked by the library against Google's two accepted issuer strings.
 *
 * ## Why the failure modes are separated
 *
 * "Your token is bad" and "we could not reach Google" are the same exception from the
 * library and must not be the same response. A user whose sign-in failed because Google's
 * JWKS endpoint was slow has done nothing wrong, and a `401` would send them to a password
 * form for an account that may not have a password.
 */

export interface GoogleIdentity {
  /** `sub`. Stable for the life of the Google account, and never reused. */
  readonly subjectId: string;
  readonly email: string;
  /** Google's own claim about the address. `false` is a refusal, not a warning. */
  readonly emailVerified: boolean;
  readonly name: string | undefined;
}

/** The token was not acceptable. One class for every reason, as with access tokens. */
export class InvalidGoogleTokenError extends Error {
  constructor(readonly reason: string) {
    super("The Google sign-in could not be verified.");
    this.name = "InvalidGoogleTokenError";
  }
}

/** Google could not be reached. The caller's problem to map to a 503, not a 401. */
export class GoogleUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Google sign-in is temporarily unavailable.");
    this.name = "GoogleUnavailableError";
    if (cause !== undefined) this.cause = cause;
  }
}

export interface GoogleTokenVerifier {
  verify(idToken: string): Promise<GoogleIdentity>;
}

/**
 * The reasons `verifyIdToken` rejects a token, as opposed to failing to check it.
 *
 * The library reports both as `Error` with a message, so the distinction has to be made
 * on the message. That is fragile, and the fragility is deliberately one-directional: an
 * unrecognised failure is treated as **unavailable**, so a library wording change makes
 * sign-in briefly report a 503 rather than silently start accepting something.
 *
 * ## The message is matched and then thrown away
 *
 * Each pattern maps to a fixed slug, and the slug is what becomes `reason`. The library's
 * own message must never propagate, because several of its messages **contain the input**:
 *
 *   throw new Error('Invalid token signature: ' + jwt);
 *   throw new Error("Can't parse token payload: " + segments[1]);
 *   throw new Error('No pem found for envelope: ' + JSON.stringify(envelope));
 *   throw new Error('No issue time in token: ' + JSON.stringify(payload));
 *
 * An `id_token` is a bearer credential, and `reason` is logged. Forwarding the message
 * would put a live credential -- and, in the `payload` cases, somebody's email address --
 * into the log stream, which is exactly what `docs/DEVOPS/06` § Mandatory Redaction
 * exists to prevent. Redaction works on key names and could not have caught this, because
 * the value would have arrived inside a string called `reason`.
 */
const REJECTIONS: readonly (readonly [RegExp, string])[] = [
  [/wrong recipient/i, "wrong_audience"],
  [/invalid issuer/i, "wrong_issuer"],
  [/token used too late/i, "expired"],
  [/expiration time too far in future/i, "implausible_expiry"],
  [/token used too early/i, "not_yet_valid"],
  [/invalid token signature/i, "bad_signature"],
  [/no pem found/i, "unknown_signing_key"],
  [/wrong number of segments/i, "malformed"],
  [/can't parse token/i, "malformed"],
  [/no (issue|expiration) time in token/i, "missing_time_claim"],
  [/(iat|exp) field using invalid format/i, "malformed_time_claim"],
];

function classify(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  for (const [pattern, reason] of REJECTIONS) {
    if (pattern.test(message)) return new InvalidGoogleTokenError(reason);
  }

  // Unrecognised. Fails safe: a 503 while somebody updates this list beats quietly
  // accepting a token for a reason nobody enumerated.
  return new GoogleUnavailableError(error);
}

export function createGoogleTokenVerifier(
  clientId: string | undefined,
): GoogleTokenVerifier {
  return {
    async verify(idToken: string): Promise<GoogleIdentity> {
      if (clientId === undefined || clientId.length === 0) {
        // Not a 401. The user did nothing wrong; the deployment is missing a variable,
        // and the message says which one rather than leaving an operator to guess from
        // a generic sign-in failure.
        throw new GoogleUnavailableError(
          new Error(
            "GOOGLE_OAUTH_CLIENT_ID is not configured; Google sign-in is disabled.",
          ),
        );
      }

      // Constructed per call rather than held: `OAuth2Client` caches Google's keys
      // internally, and the cost of a new instance is trivial next to a network round
      // trip on a cache miss. Holding one would make the key cache process-lifetime,
      // which is fine until a key is revoked.
      const client = new OAuth2Client(clientId);

      let payload: TokenPayload | undefined;
      try {
        const ticket = await client.verifyIdToken({
          idToken,
          // THE argument. Omit it and a token minted for any other Google application
          // verifies here. The mutation in the spec deletes this line.
          audience: clientId,
        });
        payload = ticket.getPayload();
      } catch (error) {
        throw classify(error);
      }

      if (payload === undefined) {
        throw new InvalidGoogleTokenError("empty_payload");
      }

      const { sub, email, email_verified: emailVerified, name } = payload;

      // A signed token from Google without a `sub` should not exist. If it ever does, the
      // safe reading is that this is not the token we think it is.
      if (typeof sub !== "string" || sub.length === 0) {
        throw new InvalidGoogleTokenError("missing_subject");
      }
      if (typeof email !== "string" || email.length === 0) {
        throw new InvalidGoogleTokenError("missing_email");
      }

      return {
        subjectId: sub,
        email: email.trim().toLowerCase(),
        // Strictly `=== true`. Absent must not read as verified.
        emailVerified: emailVerified === true,
        name: typeof name === "string" && name.length > 0 ? name : undefined,
      };
    },
  };
}

/** Injection token, so a test can supply a verifier that never touches the network. */
export const GOOGLE_TOKEN_VERIFIER = Symbol("GOOGLE_TOKEN_VERIFIER");
