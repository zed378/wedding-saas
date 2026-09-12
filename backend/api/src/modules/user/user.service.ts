import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, ne } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import {
  refreshTokens,
  userNotificationPreferences,
  users,
} from "../../infra/db/schema/users";
import {
  BusinessRuleError,
  NotFoundError,
  ValidationError,
} from "../../http/errors";
import { logger } from "../../shared/logging/logger";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";
import {
  checkPasswordPolicy,
  hashPassword,
  verifyPassword,
} from "../auth/password";
import {
  hashRefreshToken,
  revokeAllForUser,
} from "../auth/tokens/refresh-token.service";

/**
 * P1-08 — the current user's own profile. `docs/API/02`.
 *
 * ## Every method takes a TenantScope and none takes a user id
 *
 * `docs/API/02` § Object-Level Authorization: these endpoints "operate ONLY on
 * `current_user.id` from the token — they do NOT accept a `user_id` from the client as a
 * parameter determining the target (preventing IDOR by design)".
 *
 * That is implemented as a signature rather than as a check. The scope is the branded type
 * from `P0-11`, which only `tenantScope()` produces and which `requireAuth()` derives from
 * the authenticated row. There is no parameter for a client value to reach, so the IDOR
 * this section is about cannot be expressed — not "is rejected", but has nowhere to go.
 *
 * ## Mass assignment
 *
 * `UPDATABLE_FIELDS` is the whitelist, and the Zod schema in the controller is the other
 * half (`docs/BACKEND/03` § Field Whitelisting). Both exist because they fail differently:
 * the schema strips what a client sends, and this constant is what stops a future edit
 * from spreading a validated object into `.set()`.
 */

/** The only columns a user may change about themselves. `docs/API/02` § Validation. */
export const UPDATABLE_FIELDS = ["fullName", "phone"] as const;

/**
 * Everything a client must never be able to set on itself.
 *
 * Listed rather than implied, so the mass-assignment test has something to iterate and so
 * the intent survives somebody adding a column.
 */
export const FORBIDDEN_FIELDS = [
  "role",
  "email",
  "email_verified",
  "status",
  "password_hash",
  "oauth_provider",
  "oauth_subject_id",
  "deleted_at",
] as const;

export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly role: string;
  readonly emailVerified: boolean;
  readonly createdAt: Date;
}

export interface NotificationPreferences {
  readonly rsvpEmail: boolean;
  readonly guestbookEmail: boolean;
  readonly marketingEmail: boolean;
}

export interface DeletionResult {
  readonly status: "scheduled";
  /** How many invitations keep serving until their own expiry. ADR-051. */
  readonly liveInvitations: number;
}

@Injectable()
export class UserService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly invitations: InvitationRepository,
  ) {}

  async getProfile(scope: TenantScope): Promise<UserProfile> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        role: users.role,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(eq(users.id, scope), isNull(users.deletedAt)))
      .limit(1);

    const profile = rows[0];
    // Reachable when an account is deleted while a still-valid access token is in flight.
    if (profile === undefined) throw new NotFoundError();
    return profile;
  }

  /**
   * Update the two fields `docs/API/02` permits.
   *
   * The argument type is the whitelist. A caller cannot pass `role` because the parameter
   * has no such property, which is a stronger guarantee than filtering an object would be.
   */
  async updateProfile(
    scope: TenantScope,
    changes: { fullName?: string; phone?: string | null },
  ): Promise<UserProfile> {
    const patch: Record<string, unknown> = {};
    if (changes.fullName !== undefined)
      patch["fullName"] = changes.fullName.trim();
    if (changes.phone !== undefined) {
      // An empty string clears the column rather than storing "". `phone` is nullable and
      // "no phone" should be NULL, not a value that sorts and compares like one.
      patch["phone"] =
        changes.phone === null || changes.phone.trim().length === 0
          ? null
          : changes.phone.trim();
    }

    if (Object.keys(patch).length > 0) {
      patch["updatedAt"] = new Date();
      await this.db
        .update(users)
        .set(patch)
        .where(and(eq(users.id, scope), isNull(users.deletedAt)));
    }

    return this.getProfile(scope);
  }

  /**
   * Change a password, knowing the old one.
   *
   * ## Why other sessions are revoked
   *
   * A password change is the second thing somebody does when they suspect their account is
   * compromised (`P1-05`'s reset being the first, for when they cannot log in). If the
   * attacker's refresh token survives it, the change accomplished nothing except telling
   * them they have been noticed.
   *
   * The **current** session survives, which is the difference from a reset: the user is
   * here, authenticated, and logging them out of the tab they are typing in is a
   * usability cost with no security benefit.
   */
  async changePassword(
    scope: TenantScope,
    oldPassword: string,
    newPassword: string,
    keepRefreshToken: string | undefined,
    pepper: string,
  ): Promise<{ sessionsRevoked: number }> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(and(eq(users.id, scope), isNull(users.deletedAt)))
      .limit(1);

    const user = rows[0];
    if (user === undefined) throw new NotFoundError();

    // An OAuth-only account has no password to confirm. Sending them to the reset flow is
    // the honest answer: it proves control of the address, which is the only proof they
    // can offer.
    if (user.passwordHash === null) {
      throw new BusinessRuleError(
        "NO_PASSWORD_SET",
        "Akun ini belum memiliki kata sandi. Gunakan tautan atur ulang kata sandi.",
      );
    }

    if (!(await verifyPassword(user.passwordHash, oldPassword))) {
      // On the old password, deliberately -- this is not an enumeration surface (the
      // caller is already authenticated as this user) and a vague error would send them
      // hunting through their new password for a typo that is not there.
      throw new ValidationError(
        [{ field: "old_password", message: "Kata sandi saat ini salah." }],
        "Kata sandi saat ini salah.",
      );
    }

    const violations = await checkPasswordPolicy(newPassword, {
      email: user.email,
      fullName: user.fullName,
    });
    if (violations.length > 0) {
      throw new ValidationError(
        violations.map((v) => ({ field: "new_password", message: v.message })),
      );
    }

    const passwordHash = await hashPassword(newPassword);

    const sessionsRevoked = await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, scope));

      // Same transaction as the password write, for the same reason as `P1-05`: a crash
      // between them leaves a new password and the attacker's session both working.
      const keepHash =
        keepRefreshToken === undefined
          ? undefined
          : hashRefreshToken(pepper, keepRefreshToken);

      const revoked = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.userId, scope),
            isNull(refreshTokens.revokedAt),
            ...(keepHash === undefined
              ? []
              : [ne(refreshTokens.tokenHash, keepHash)]),
          ),
        )
        .returning({ id: refreshTokens.id });

      return revoked.length;
    });

    await this.queue.enqueue("general", "notification.send", {
      template: "password_changed",
      userId: scope,
    });

    logger.info(
      {
        context: {
          user_id: scope,
          event: "auth.password_changed",
          sessions_revoked: sessionsRevoked,
        },
      },
      "password changed",
    );

    return { sessionsRevoked };
  }

  async getPreferences(scope: TenantScope): Promise<NotificationPreferences> {
    const rows = await this.db
      .select({
        rsvpEmail: userNotificationPreferences.rsvpEmail,
        guestbookEmail: userNotificationPreferences.guestbookEmail,
        marketingEmail: userNotificationPreferences.marketingEmail,
      })
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, scope))
      .limit(1);

    // `P1-02` and `P1-04` both create this row with the user, so its absence means an
    // account that predates them or a hand-written row. Defaults rather than a 404: a
    // missing preferences row is not a missing user.
    return (
      rows[0] ?? {
        rsvpEmail: true,
        guestbookEmail: true,
        marketingEmail: false,
      }
    );
  }

  async updatePreferences(
    scope: TenantScope,
    changes: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences> {
    const patch: Record<string, unknown> = {};
    if (changes.rsvpEmail !== undefined) patch["rsvpEmail"] = changes.rsvpEmail;
    if (changes.guestbookEmail !== undefined) {
      patch["guestbookEmail"] = changes.guestbookEmail;
    }
    if (changes.marketingEmail !== undefined) {
      patch["marketingEmail"] = changes.marketingEmail;
    }

    if (Object.keys(patch).length > 0) {
      patch["updatedAt"] = new Date();
      // Upsert, because the row may not exist for an account that predates P1-02.
      await this.db
        .insert(userNotificationPreferences)
        .values({
          userId: scope,
          rsvpEmail: changes.rsvpEmail ?? true,
          guestbookEmail: changes.guestbookEmail ?? true,
          marketingEmail: changes.marketingEmail ?? false,
        })
        .onConflictDoUpdate({
          target: userNotificationPreferences.userId,
          set: patch,
        });
    }

    return this.getPreferences(scope);
  }

  /**
   * Request account deletion. `docs/SECURITY/09` § Data Subject Rights.
   *
   * ## What happens to a published invitation — ADR-051, answering OQ-11
   *
   * A soft delete, and **published invitations keep serving until their own expiry**.
   *
   * The alternative is an immediate takedown, and the case against it is concrete: a
   * couple whose wedding is next week has sent the link to three hundred guests, and those
   * guests use it for the address and the RSVP. Honouring a deletion request by breaking
   * that is not a privacy win — the data it removes from public view is the requester's
   * own, published by them on purpose, while the harm lands on people who did not ask for
   * anything.
   *
   * `invitations.owner_id` is `ON DELETE RESTRICT` (`docs/DATABASE/01`), so the database
   * already refuses to hard-delete a user with invitations. This makes that refusal a
   * deliberate policy rather than a constraint somebody trips over.
   *
   * The account is unusable immediately: `deleted_at` is set, every session is revoked,
   * and `SessionService` already filters on `deleted_at IS NULL`. The invitation outlives
   * the login, not the other way round.
   */
  async requestDeletion(scope: TenantScope): Promise<DeletionResult> {
    const rows = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.id, scope), isNull(users.deletedAt)))
      .limit(1);

    if (rows[0] === undefined) throw new NotFoundError();

    // Through the repository, never the table. `scripts/check-tenant-scope.mjs` refuses a
    // direct import, and it is right to: the owner predicate belongs in the one file that
    // is supposed to be read carefully.
    const liveInvitations = await this.invitations.countOwnedByStatus(scope, [
      "published",
      "expired",
    ]);

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
          // The address is NOT scrambled here. ADR-031's partial unique index already
          // frees it for a new account, and keeping it readable is what lets support
          // answer "did I delete this?" during the retention window. The hard delete
          // under BR-9 is what removes it.
        })
        .where(eq(users.id, scope));

      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(refreshTokens.userId, scope), isNull(refreshTokens.revokedAt)),
        );
    });

    // Step 5 requires a confirmation email. It is also the only signal the real owner gets
    // if somebody else requested this.
    await this.queue.enqueue("general", "notification.send", {
      template: "account_deletion_requested",
      userId: scope,
      liveInvitations,
    });

    logger.info(
      {
        context: {
          user_id: scope,
          event: "user.deletion_requested",
          live_invitations: liveInvitations,
        },
      },
      "account deletion requested",
    );

    return { status: "scheduled", liveInvitations };
  }

  /** Exported for the deletion path and for `P1-05`. Kept here so tests can reach it. */
  async revokeEverySession(scope: TenantScope): Promise<number> {
    return revokeAllForUser(this.db, scope);
  }
}
