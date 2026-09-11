import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import {
  userNotificationPreferences,
  users,
} from "../../infra/db/schema/users";
import { logger } from "../../shared/logging/logger";
import { checkPasswordPolicy, hashPassword } from "./password";
import {
  consumeToken,
  issueToken,
  type SingleUseTokenType,
} from "./tokens/single-use-token.service";

/**
 * P1-02 — registration and email verification.
 *
 * ## The response never says whether the email exists
 *
 * `docs/SECURITY/03` § Login Rate Limiting establishes the principle for login; it
 * applies at least as strongly here, because `register` is unauthenticated and
 * unlimited by nature. A `409 EMAIL_EXISTS` would make this endpoint an oracle for "does
 * this person have an account on a wedding-invitation service", which is socially
 * sensitive in a way a generic SaaS signup is not.
 *
 * So both paths return the same status, the same body, and take a broadly similar amount
 * of work — and the real owner still gets an email, because otherwise the one person
 * entitled to know somebody is probing their account is the only one kept in the dark.
 */

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly fullName: string;
}

export interface PolicyFailure {
  readonly field: string;
  readonly message: string;
}

export type RegisterResult =
  /** Uniform on purpose: the caller cannot tell these apart, and neither can a user. */
  | { readonly status: "accepted" }
  | {
      readonly status: "rejected";
      readonly violations: readonly PolicyFailure[];
    };

export type VerifyResult =
  | { readonly status: "verified" }
  /** Already verified, or the link was clicked twice. A no-op, not an error. */
  | { readonly status: "already_verified" }
  | { readonly status: "expired" }
  | { readonly status: "invalid" };

@Injectable()
export class RegistrationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async register(input: RegisterInput): Promise<RegisterResult> {
    // Lowercased for storage and comparison: `Budi@Gmail.com` and `budi@gmail.com` are
    // one mailbox, and a case-sensitive index would happily hold both.
    const email = input.email.trim().toLowerCase();

    // The policy runs BEFORE the existence check, so a weak password is rejected
    // identically whether or not the address is taken. Checking existence first and
    // short-circuiting would leak through which error came back.
    const violations = await checkPasswordPolicy(input.password, {
      email,
      fullName: input.fullName,
    });

    if (violations.length > 0) {
      return {
        status: "rejected",
        violations: violations.map((v) => ({
          field: v.field,
          message: v.message,
        })),
      };
    }

    // Hashed before the existence check, so the expensive work happens on both paths.
    // Without this the response time distinguishes them as clearly as a status code
    // would -- the argon2 cost from P1-01 is 277 ms and impossible to miss.
    const passwordHash = await hashPassword(input.password);

    const existing = await this.db
      .select({ id: users.id, emailVerified: users.emailVerified })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    if (existing[0] !== undefined) {
      // Tell the owner, not the caller. The job is fire-and-forget by design.
      await this.queue.enqueue("general", "notification.send", {
        template: "registration_attempt_existing_account",
        userId: existing[0].id,
      });
      return { status: "accepted" };
    }

    const created = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email,
          passwordHash,
          fullName: input.fullName.trim(),
          emailVerified: false,
        })
        .returning({ id: users.id });

      // Created here so no later query has to defend against its absence (step 6).
      await tx.insert(userNotificationPreferences).values({ userId: user!.id });

      return user!.id;
    });

    // Issued after the user exists. A token referencing a rolled-back user would be a
    // foreign key violation at best and a dangling live link at worst.
    const { token } = await issueToken(
      this.db,
      created,
      "email_verification" satisfies SingleUseTokenType,
    );

    // AFTER the commit. A job emitted inside the transaction can describe a user that
    // never existed -- the worker would race the commit and look up a missing row.
    await this.queue.enqueue("general", "notification.send", {
      template: "email_verification",
      userId: created,
      token,
    });

    logger.info(
      { context: { user_id: created, event: "auth.registration" } },
      "user registered",
    );

    return { status: "accepted" };
  }

  /**
   * Redeem a verification token.
   *
   * The user comes from the token. There is no user id in the request, which is what
   * makes "verify someone else's address" not a thing that can be attempted.
   */
  async verifyEmail(token: string): Promise<VerifyResult> {
    const result = await consumeToken(this.db, token, "email_verification");

    if (result.status === "invalid") return { status: "invalid" };
    if (result.status === "expired") return { status: "expired" };

    if (result.status === "already_used") {
      // A second click, or a mail client that prefetched the link. Not an error: the
      // address is verified, which is what the user was trying to achieve.
      return { status: "already_verified" };
    }

    await this.db
      .update(users)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(users.id, result.userId));

    logger.info(
      { context: { user_id: result.userId, event: "auth.email_verified" } },
      "email verified",
    );

    return { status: "verified" };
  }

  /**
   * Re-send a verification email.
   *
   * Uniform response: an unknown address, a known unverified one and a known verified
   * one are indistinguishable to the caller.
   */
  async resendVerification(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();

    const found = await this.db
      .select({ id: users.id, emailVerified: users.emailVerified })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    const user = found[0];
    // Nothing to do, and nothing to say. Returning early here is safe in a way it would
    // not be on `register`: there is no expensive branch on the other side for a timing
    // difference to reveal.
    if (user === undefined || user.emailVerified) return;

    const { token } = await issueToken(this.db, user.id, "email_verification");

    await this.queue.enqueue("general", "notification.send", {
      template: "email_verification",
      userId: user.id,
      token,
    });
  }
}
