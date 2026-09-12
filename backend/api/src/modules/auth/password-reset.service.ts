import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import { refreshTokens, users, userTokens } from "../../infra/db/schema/users";
import { ForbiddenError, ValidationError } from "../../http/errors";
import { logSecurityEvent, logger } from "../../shared/logging/logger";
import { checkPasswordPolicy, hashPassword } from "./password";
import {
  consumeToken,
  hashToken,
  issueToken,
} from "./tokens/single-use-token.service";

/**
 * P1-05 — forgot and reset password.
 *
 * ## The reset is assumed to be an incident, not an inconvenience
 *
 * `docs/SECURITY/03` § Password Reset: a successful reset "invalidates all active
 * sessions/refresh tokens after a successful reset (mitigation in case the account was
 * already compromised previously)". The parenthetical is the whole design. Most resets
 * are somebody who forgot; the ones that matter are somebody taking their account back,
 * and in those the attacker is holding a refresh token that is good for thirty days.
 *
 * So the revocation happens in the **same transaction** as the password write. A crash
 * between them would leave a changed password with live old sessions -- precisely the
 * state the requirement exists to prevent, and one nobody would notice.
 */

export type ResetResult =
  | { readonly status: "ok" }
  | { readonly status: "invalid" }
  | { readonly status: "expired" };

/**
 * The nil UUID. A valid UUID that matches no user, so the no-account path can run
 * statements shaped like the real one's without violating a foreign key. See `request`.
 */
const NO_USER = "00000000-0000-0000-0000-000000000000";

@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  /**
   * Ask for a reset link.
   *
   * Uniform for a known address, an unknown one, and an account with no password at all.
   *
   * ## Why the unknown path still touches the database
   *
   * The DoD asks for the two to be indistinguishable "in both body and timing". The body
   * is easy. For timing, the known path costs a `SELECT` plus a transaction containing an
   * `UPDATE` and an `INSERT`; returning early on the unknown path would cost a `SELECT`,
   * and the difference is two round trips -- small, but a difference that grows with
   * database latency and is measurable by anyone willing to average.
   *
   * So the unknown path runs the same transaction against `NO_USER`, which matches
   * nothing and inserts nothing. This is weaker than `P1-01`'s dummy-hash trick, which
   * achieves genuine cost equality because there is an expensive operation to mirror.
   * Here there is not, and the honest claim is "the same statements, so the same order of
   * magnitude" rather than "identical".
   */
  async request(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();

    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        status: users.status,
      })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    const user = rows[0];

    // A suspended account is treated as unknown: a reset would not help, and saying so
    // would confirm the address exists.
    const target =
      user !== undefined && user.status === "active" ? user : undefined;

    if (target === undefined) {
      await this.equivalentWork();
      return;
    }

    const { token } = await issueToken(this.db, target.id, "password_reset");

    // An OAuth-only account has no password and still gets a link. They own the address,
    // "set a password" is a reasonable thing to want, and refusing would make the account
    // distinguishable from an unknown one by whether an email arrives.
    await this.queue.enqueue("general", "notification.send", {
      template: "password_reset",
      userId: target.id,
      token,
    });

    logger.info(
      {
        context: { user_id: target.id, event: "auth.password_reset_requested" },
      },
      "password reset requested",
    );
  }

  /**
   * The same database work `issueToken` does, against a user that cannot exist.
   *
   * One transaction, two statements, both matching nothing -- an `INSERT` is not usable
   * here because `user_tokens.user_id` is a foreign key and a nil UUID would raise 23503
   * rather than costing a round trip.
   *
   * This equalises round trips, not CPU. `P1-01` can claim genuine cost equality because
   * there is a 277 ms hash to mirror; here the work is a handful of network hops and the
   * honest claim is "the same statements, so the same order of magnitude".
   */
  private async equivalentWork(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(userTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(userTokens.userId, NO_USER),
            eq(userTokens.type, "password_reset"),
            isNull(userTokens.usedAt),
          ),
        );

      await tx
        .update(userTokens)
        .set({ usedAt: new Date() })
        .where(eq(userTokens.userId, NO_USER));
    });
  }

  /**
   * Redeem a reset token and set a new password.
   *
   * Takes no user id. The user comes from the token, which is what makes "reset somebody
   * else's password" not a thing that can be attempted.
   */
  async reset(token: string, newPassword: string): Promise<ResetResult> {
    const consumed = await consumeToken(this.db, token, "password_reset");

    if (consumed.status === "expired") return { status: "expired" };
    if (consumed.status !== "ok") {
      // `invalid` and `already_used` are one answer. A replay that said "already used"
      // would confirm the token had once been real, which is information about somebody
      // else's account.
      logSecurityEvent("auth.login_failed", {
        event_detail: "password_reset_token_rejected",
      });
      return { status: "invalid" };
    }

    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        status: users.status,
      })
      .from(users)
      .where(and(eq(users.id, consumed.userId), isNull(users.deletedAt)))
      .limit(1);

    const user = rows[0];
    if (user === undefined) return { status: "invalid" };
    if (user.status !== "active") {
      throw new ForbiddenError(
        "FORBIDDEN",
        "Akun ini dinonaktifkan. Hubungi dukungan pelanggan.",
      );
    }

    // The policy applies to a password being SET, and this is one. The email and name go
    // in as context because that is what activates P1-01's identity-resemblance rule.
    const violations = await checkPasswordPolicy(newPassword, {
      email: user.email,
      fullName: user.fullName,
    });

    if (violations.length > 0) {
      // The token has already been consumed at this point, so a rejected password costs
      // the user a new link. That is deliberate: leaving it live until a valid password
      // arrived would make the token multi-use for anyone holding it.
      throw new ValidationError(
        violations.map((v) => ({ field: "new_password", message: v.message })),
      );
    }

    const passwordHash = await hashPassword(newPassword);

    const revokedCount = await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      // SAME TRANSACTION. docs/SECURITY/03: a reset invalidates every active session,
      // because the reason for the reset may be that somebody else is holding one. A
      // crash between these two statements would leave a new password and the attacker's
      // thirty-day refresh token both working.
      const revoked = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.userId, user.id),
            isNull(refreshTokens.revokedAt),
          ),
        )
        .returning({ id: refreshTokens.id });

      // Any other live reset token dies too. Two links in two emails, one of which the
      // attacker requested, is not a state to leave behind.
      await tx
        .update(userTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(userTokens.userId, user.id),
            eq(userTokens.type, "password_reset"),
            isNull(userTokens.usedAt),
          ),
        );

      return revoked.length;
    });

    // Step 5. The one person who can say "that was not me" is the account owner, and this
    // is the only thing that tells them.
    await this.queue.enqueue("general", "notification.send", {
      template: "password_changed",
      userId: user.id,
    });

    logger.info(
      {
        context: {
          user_id: user.id,
          event: "auth.password_reset_completed",
          // The difference between "somebody forgot their password" and "somebody just
          // kicked an intruder out" is this number.
          sessions_revoked: revokedCount,
        },
      },
      "password reset completed",
    );

    return { status: "ok" };
  }

  /**
   * Whether a reset token is currently redeemable, without spending it.
   *
   * For the frontend's "is this link still good?" check before showing a password form
   * (`P1-20`). Deliberately says only yes or no: a caller learns nothing about whose token
   * it is, or whether an unusable one was expired, spent, or never real.
   */
  async isRedeemable(token: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: userTokens.id })
      .from(userTokens)
      .where(
        and(
          eq(userTokens.tokenHash, hashToken(token)),
          eq(userTokens.type, "password_reset"),
          isNull(userTokens.usedAt),
          sql`${userTokens.expiresAt} > now()`,
        ),
      )
      .limit(1);

    return rows.length > 0;
  }
}
