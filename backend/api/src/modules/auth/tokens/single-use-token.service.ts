import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "../../../infra/db/client";
import { userTokens } from "../../../infra/db/schema/users";

/**
 * P1-01/P1-02 — single-use tokens: email verification and password reset.
 *
 * `docs/DATABASE/02` § Single-Use Token Table (ADR-020) gives the shape: a hashed token,
 * a `type`, an `expires_at` and a `used_at`. This is the only code that writes it.
 *
 * ## Why SHA-256 and not argon2
 *
 * `P1-01` hashes passwords with argon2id at 277 ms, and using the same thing here would
 * look consistent and be wrong. Argon2's cost exists to make *guessing* expensive, which
 * matters for a password because a human chose it and the space is small.
 *
 * These tokens are 256 bits from `randomBytes`. There is nothing to guess: an attacker
 * who could try a billion per second for the age of the universe would not finish. The
 * only property needed is that the stored value does not reveal the token if the
 * database leaks, and a single SHA-256 gives that. Adding 277 ms to every click of a
 * verification link would buy exactly nothing.
 *
 * ## Single use is enforced by the UPDATE, not by a read
 *
 * `consume` does not "check then mark". It issues one conditional `UPDATE ... WHERE
 * used_at IS NULL` and treats **rows affected** as the answer. Two simultaneous clicks
 * on the same link — a mail client prefetching while the user clicks — race in the
 * database, and exactly one of them updates a row. A read-then-write would let both
 * through, and the window is exactly as wide as the round trip.
 */

/** The token types `user_tokens.type` holds. A closed set. */
export type SingleUseTokenType = "email_verification" | "password_reset";

export interface IssuedToken {
  /** Sent to the user. Never stored, never logged. */
  readonly token: string;
  readonly expiresAt: Date;
}

export type ConsumeResult =
  | { readonly status: "ok"; readonly userId: string }
  /** No such token, or it belongs to another type. Indistinguishable on purpose. */
  | { readonly status: "invalid" }
  | { readonly status: "expired" }
  /** Already redeemed. The caller decides whether that is an error. */
  | { readonly status: "already_used"; readonly userId: string };

/** `docs/SECURITY/03`: verification 24 hours, reset 1 hour. */
export const TOKEN_LIFETIME_MS: Readonly<Record<SingleUseTokenType, number>> = {
  email_verification: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
};

/**
 * The stored form of a token.
 *
 * Exported so a test can assert that what reaches the database is not what was emailed.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 256 bits, URL-safe. `base64url` so it survives being pasted out of an email client. */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Issue a token of a given type for a user.
 *
 * Any **unused** token of the same type is revoked first. Otherwise "resend verification"
 * leaves a trail of live links in old emails, and the oldest of them stays valid for its
 * full 24 hours -- including one that may have been forwarded or logged by a mail
 * gateway. One live token per purpose per user.
 */
export async function issueToken(
  db: Database,
  userId: string,
  type: SingleUseTokenType,
  now: Date = new Date(),
): Promise<IssuedToken> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_MS[type]);

  await db.transaction(async (tx) => {
    await tx
      .update(userTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(userTokens.userId, userId),
          eq(userTokens.type, type),
          isNull(userTokens.usedAt),
        ),
      );

    await tx.insert(userTokens).values({
      userId,
      type,
      tokenHash: hashToken(token),
      expiresAt,
    });
  });

  return { token, expiresAt };
}

/**
 * Redeem a token, atomically.
 *
 * The user is derived from the token and never taken from the request. That is what
 * stops one user verifying another's address: there is no parameter to tamper with.
 */
export async function consumeToken(
  db: Database,
  token: string,
  type: SingleUseTokenType,
  now: Date = new Date(),
): Promise<ConsumeResult> {
  const tokenHash = hashToken(token);

  // One statement. `used_at IS NULL` in the WHERE clause is the mutual exclusion: the
  // database decides which of two concurrent redemptions wins.
  const claimed = await db
    .update(userTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(userTokens.tokenHash, tokenHash),
        eq(userTokens.type, type),
        isNull(userTokens.usedAt),
        sql`${userTokens.expiresAt} > ${now}`,
      ),
    )
    .returning({ userId: userTokens.userId });

  const row = claimed[0];
  if (row !== undefined) return { status: "ok", userId: row.userId };

  // Nothing was claimed. Find out why -- the three reasons need different responses, and
  // this read cannot race anything because the claim above already failed.
  const existing = await db
    .select({
      userId: userTokens.userId,
      usedAt: userTokens.usedAt,
      expiresAt: userTokens.expiresAt,
    })
    .from(userTokens)
    .where(and(eq(userTokens.tokenHash, tokenHash), eq(userTokens.type, type)))
    .limit(1);

  const found = existing[0];
  if (found === undefined) return { status: "invalid" };
  if (found.usedAt !== null) {
    return { status: "already_used", userId: found.userId };
  }
  return { status: "expired" };
}

/**
 * Constant-time comparison of two tokens.
 *
 * Not used by `consumeToken` -- that compares in the database, by hash, where timing
 * tells an attacker nothing about a value they would have to guess in full anyway. It is
 * exported for call sites that hold two tokens in memory and would otherwise reach for
 * `===`.
 */
export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
