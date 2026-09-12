import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

/**
 * P1-03 — the 15-minute access token. `docs/API/01` § Token Strategy.
 *
 * ## Why `jose` and not `jsonwebtoken`
 *
 * The classic JWT vulnerability class is algorithm confusion: a verifier that reads `alg`
 * out of the token it is checking will happily accept `alg: "none"`, or verify an RS256
 * public key as an HS256 shared secret. `jsonwebtoken` is safe only if every call site
 * remembers `algorithms: ["HS256"]`, and the failure is silent when one forgets.
 *
 * `jose` requires the algorithm list, and this module is the only place in the codebase
 * that verifies a token, so there is exactly one call site to get right. Both mistakes
 * have tests below that would fail if this file changed.
 *
 * `jose@6` is ESM-only and this package compiles to CommonJS. That works: the import is
 * statically checked by TypeScript 7 under `module: NodeNext` and resolved at runtime by
 * Node 24's `require(esm)`. It was verified against the built `dist/` output, not just
 * under Vitest, because Vitest loads ESM natively and would not have caught a failure
 * that only shows up in production (ADR-046).
 *
 * ## What the claims are for
 *
 * `role` and `email_verified` are IN the token and are NOT trusted from it. They travel
 * so that a future read-only path could avoid a query; today every authenticated request
 * re-reads the user row, because `docs/SECURITY/01` § Elevation of Privilege requires a
 * role change or a suspension to take effect before the token expires. See
 * `session.service.ts`, which is what actually answers "who is this".
 */

/** `docs/API/01`: "short expiry (15 minutes)". */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** The only algorithm this service will sign or accept. */
const ALGORITHM = "HS256";

/**
 * Pinned and checked on verify. Not a security control on its own — an attacker who can
 * sign tokens can set any issuer — but it stops a token minted by a *different service*
 * sharing the same secret from being accepted here, which is a real deployment mistake.
 */
const ISSUER = "wedding-invitation";
const AUDIENCE = "wedding-invitation-api";

export interface AccessTokenClaims {
  /** `sub`. The user's UUID. */
  readonly userId: string;
  readonly role: string;
  readonly emailVerified: boolean;
}

/** Thrown for every rejection reason. The caller must not tell them apart. */
export class InvalidAccessTokenError extends Error {
  constructor(readonly reason: string) {
    super("The access token is not valid.");
    this.name = "InvalidAccessTokenError";
  }
}

/**
 * `docs/SECURITY/03` wants the key in a secret manager. What this module needs is that it
 * is long enough to be worth signing with: 32 bytes is the HMAC-SHA256 block-equivalent
 * floor, below which the key is the weak part of the construction.
 */
const MIN_KEY_LENGTH = 32;

function encodeKey(signingKey: string): Uint8Array {
  if (signingKey.length < MIN_KEY_LENGTH) {
    // Not a validation nicety. A short HMAC key is brute-forceable offline from a single
    // captured token, and every forged token after that is indistinguishable from real.
    throw new Error(
      `JWT_SIGNING_KEY must be at least ${MIN_KEY_LENGTH} characters.`,
    );
  }
  return new TextEncoder().encode(signingKey);
}

export async function signAccessToken(
  signingKey: string,
  claims: AccessTokenClaims,
  now: Date = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);

  return new SignJWT({
    // snake_case in the token, matching `docs/API/01`'s field naming for the wire.
    role: claims.role,
    email_verified: claims.emailVerified,
  })
    .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
    .sign(encodeKey(signingKey));
}

/**
 * Verify a token and return its claims.
 *
 * Throws `InvalidAccessTokenError` for every failure, with a `reason` that is for logs
 * only. The HTTP layer returns one 401 for all of them: "expired" and "bad signature" are
 * different to us and must not be different to a caller.
 */
export async function verifyAccessToken(
  signingKey: string,
  token: string,
  now: Date = new Date(),
): Promise<AccessTokenClaims> {
  // OUTSIDE the try. A key that is too short is an operator error, and wrapping it as
  // `InvalidAccessTokenError` would surface a misconfigured deployment as every user's
  // session mysteriously failing to authenticate -- a 401 nobody would think to trace
  // back to an environment variable. It must propagate as itself.
  const key = encodeKey(signingKey);

  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      // THE line. Without it, `jose` would still refuse `alg: none`, but an RS256 token
      // would be verified with this secret as a public key. Pinning removes the question.
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: now,
    }));
  } catch (error) {
    const reason =
      error instanceof joseErrors.JOSEError ? error.code : "unknown";
    throw new InvalidAccessTokenError(reason);
  }

  // `jose` guarantees the signature and the registered claims. It does not know that this
  // application requires `sub`, `role` and `email_verified` to be present and of the right
  // type -- a token signed with this key by an older version of this code would pass every
  // check above and then produce `role: undefined`, which is not a role anyone reasoned
  // about.
  const { sub, role, email_verified: emailVerified } = payload;

  if (typeof sub !== "string" || sub.length === 0) {
    throw new InvalidAccessTokenError("missing_subject");
  }
  if (typeof role !== "string") {
    throw new InvalidAccessTokenError("missing_role");
  }
  if (typeof emailVerified !== "boolean") {
    throw new InvalidAccessTokenError("missing_email_verified");
  }

  return { userId: sub, role, emailVerified };
}
