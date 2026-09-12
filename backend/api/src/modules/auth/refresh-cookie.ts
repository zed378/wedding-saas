import type { CookieOptions, Request, Response } from "express";

import type { Env } from "../../config/env.schema";
import { REFRESH_COOKIE_NAME } from "./tokens/refresh-token.service";

/**
 * P1-03 — the refresh token cookie, in one place.
 *
 * `docs/SECURITY/03` § Tokens: `HttpOnly; Secure; SameSite=Lax`. Each of those three is
 * load-bearing and each is easy to lose in a copy-paste, so the attributes are written
 * once and the controller cannot spell them differently on the set and the clear -- a
 * cookie cleared with different attributes than it was set with is not cleared at all,
 * which would make logout look like it worked.
 *
 * **HttpOnly**: script cannot read it. This is the credential with the thirty-day life;
 *   an XSS that can read it has a month of access that surviving a password change would
 *   not end.
 * **Secure**: never sent over plain HTTP.
 * **SameSite=Lax**: not sent on a cross-site POST, which is what makes `POST /auth/refresh`
 *   not a CSRF target. `Strict` would be better still, except that it also withholds the
 *   cookie on a top-level navigation from an email link, so a user following a
 *   verification link would arrive logged out. `docs/SECURITY/03` says Lax; this is why.
 * **path=/api/v1/auth**: the cookie is only ever needed by refresh and logout, so it is
 *   not attached to the hundreds of other API requests that have no use for it.
 */

/** Where the cookie is sent. Narrow on purpose -- see above. */
const COOKIE_PATH = "/api/v1/auth";

function baseOptions(env: Env): CookieOptions {
  return {
    httpOnly: true,
    // Not `env.APP_ENV !== "development"`: the deciding factor is whether the origin is
    // HTTPS, and `checkSecretRules` already refuses a non-https origin in production. A
    // Secure cookie over plain http is silently dropped by the browser, which would make
    // local development fail in a way that looks like a backend bug.
    secure: env.APP_ORIGIN.startsWith("https://"),
    sameSite: "lax",
    path: COOKIE_PATH,
  };
}

export function setRefreshCookie(
  res: Response,
  env: Env,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseOptions(env),
    expires: expiresAt,
  });
}

/**
 * Clear it.
 *
 * The server-side revocation is what actually ends the session (`docs/SECURITY/03`); this
 * only stops the browser sending a value that no longer works.
 */
export function clearRefreshCookie(res: Response, env: Env): void {
  res.clearCookie(REFRESH_COOKIE_NAME, baseOptions(env));
}

/**
 * Read it.
 *
 * The cookie is the ONLY channel. `docs/API/01` writes the refresh token as a body field
 * with "(ideally via an HTTP-only cookie)" beside it, and a body fallback would make the
 * "ideally" optional in practice: a client could keep the token in `localStorage`, and
 * the `HttpOnly` flag would be protecting a value the client also holds in the clear.
 */
export function readRefreshCookie(req: Request): string | undefined {
  const cookies: unknown = (req as { cookies?: unknown }).cookies;
  if (typeof cookies !== "object" || cookies === null) return undefined;

  const value = (cookies as Record<string, unknown>)[REFRESH_COOKIE_NAME];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
