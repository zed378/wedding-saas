import { createHmac, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "../../../infra/db/client";
import { refreshTokens } from "../../../infra/db/schema/users";

/**
 * P1-03 — rotating refresh tokens. `docs/SECURITY/03` § Tokens.
 *
 * ## Why this hashes with a pepper and `user_tokens` does not
 *
 * `P1-02` stores email-verification tokens as a plain SHA-256, and that is right there: a
 * verification token lives 24 hours and its worst case is that somebody else confirms an
 * address that was already theirs to confirm.
 *
 * A refresh token is the session. It lives thirty days, it is accepted without a password,
 * and a database leak that yields working ones is an account takeover for every logged-in
 * user at once. The pepper lives in the environment, not in the database, so a dump alone
 * -- a backup on the wrong bucket, a read-replica, a SQL injection -- is not enough to
 * turn a stored hash into a credential. It costs one HMAC.
 *
 * That means `REFRESH_TOKEN_PEPPER` is not rotatable without logging everyone out. That is
 * the correct trade and it is why the variable is required rather than defaulted: a
 * missing pepper silently falling back to an unpeppered hash would be the worst of both.
 *
 * ## Rotation and reuse
 *
 * Rotation is one conditional `UPDATE ... WHERE revoked_at IS NULL`, in the same
 * transaction as the `INSERT` of its successor -- the card's step 4, so a crash cannot
 * leave two live tokens for one session.
 *
 * If that `UPDATE` claims nothing and the row exists and is already revoked, the token was
 * used twice. `docs/SECURITY/03` is unambiguous about what that means and what to do:
 * "reuse is detected (if a revoked token is used again -> indicates theft -> revoke ALL of
 * that user's active sessions)". The family is the user because the schema has no
 * narrower unit and the document names none.
 *
 * A legitimate double-refresh -- two browser tabs, or a client retrying a timed-out
 * request -- is indistinguishable from that and will log the user out everywhere. Raised
 * as `OQ-21`; not mitigated here, because a grace window is a rule the specification does
 * not contain.
 */

/** `docs/API/01`: "long expiry (30 days)". */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The cookie `docs/SECURITY/03` requires. Named here so the controller cannot drift. */
export const REFRESH_COOKIE_NAME = "wi_refresh";

export interface IssuedRefreshToken {
  /** Goes in the cookie. Never stored, never logged, never in a response body. */
  readonly token: string;
  readonly expiresAt: Date;
}

export type RotateResult =
  | {
      readonly status: "ok";
      readonly userId: string;
      readonly issued: IssuedRefreshToken;
    }
  /** Unknown or expired. Nothing to revoke, nothing to alarm about. */
  | { readonly status: "invalid" }
  /**
   * Already revoked. Theft, per `docs/SECURITY/03`. Every session of `userId` has been
   * revoked by the time this is returned, and `revokedCount` says how many there were.
   */
  | {
      readonly status: "reuse_detected";
      readonly userId: string;
      readonly revokedCount: number;
    };

/**
 * HMAC-SHA256, not a bare digest.
 *
 * Exported so a test can assert that what reaches the database is not what went into the
 * cookie, and that the same token under a different pepper does not match.
 */
export function hashRefreshToken(pepper: string, token: string): string {
  return createHmac("sha256", pepper).update(token, "utf8").digest("hex");
}

/** 256 bits, URL-safe so it needs no cookie encoding. */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Issue a refresh token for a fresh session.
 *
 * Deliberately does NOT revoke the user's other tokens: logging in on a phone must not
 * sign them out on a laptop. That is the difference between this and `issueToken` in
 * `P1-02`, where one live link per purpose was the point.
 */
export async function issueRefreshToken(
  db: Database,
  pepper: string,
  userId: string,
  now: Date = new Date(),
): Promise<IssuedRefreshToken> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashRefreshToken(pepper, token),
    expiresAt,
  });

  return { token, expiresAt };
}

/**
 * Revoke every live refresh token a user has. Returns how many there were.
 *
 * Used by reuse detection, and by `P1-05` after a password reset -- `docs/SECURITY/03`
 * § Password Reset requires exactly this, "in case the account was already compromised".
 */
export async function revokeAllForUser(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const revoked = await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(
      and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)),
    )
    .returning({ id: refreshTokens.id });

  return revoked.length;
}

/** Revoke one token, by value. Logout. Silent if it was already revoked or unknown. */
export async function revokeRefreshToken(
  db: Database,
  pepper: string,
  token: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(refreshTokens.tokenHash, hashRefreshToken(pepper, token)),
        isNull(refreshTokens.revokedAt),
      ),
    );
}

/**
 * Spend a refresh token and issue its successor, atomically.
 *
 * The `UPDATE` is the mutual exclusion, exactly as in `P1-02`: two simultaneous
 * presentations race in the database and only one of them claims the row.
 */
export async function rotateRefreshToken(
  db: Database,
  pepper: string,
  token: string,
  now: Date = new Date(),
): Promise<RotateResult> {
  const tokenHash = hashRefreshToken(pepper, token);
  const successor = generateToken();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          sql`${refreshTokens.expiresAt} > ${now}`,
        ),
      )
      .returning({ userId: refreshTokens.userId });

    const row = rows[0];
    if (row === undefined) return undefined;

    // Same transaction as the revoke. A crash between the two would otherwise leave the
    // old token dead and no new one issued -- or, with the order reversed, two live.
    await tx.insert(refreshTokens).values({
      userId: row.userId,
      tokenHash: hashRefreshToken(pepper, successor),
      expiresAt,
    });

    return row.userId;
  });

  if (claimed !== undefined) {
    return {
      status: "ok",
      userId: claimed,
      issued: { token: successor, expiresAt },
    };
  }

  // Nothing was claimed. Why matters: a revoked token is evidence of theft, an expired or
  // unknown one is not. This read cannot race the claim above, which has already failed.
  const existing = await db
    .select({
      userId: refreshTokens.userId,
      revokedAt: refreshTokens.revokedAt,
    })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);

  const found = existing[0];
  if (found === undefined || found.revokedAt === null) {
    // Unknown, or known and merely expired. Both are "log in again".
    return { status: "invalid" };
  }

  const revokedCount = await revokeAllForUser(db, found.userId, now);
  return { status: "reuse_detected", userId: found.userId, revokedCount };
}
