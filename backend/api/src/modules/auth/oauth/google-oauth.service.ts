import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import { DB, type Database } from "../../../infra/db/client";
import {
  userNotificationPreferences,
  users,
} from "../../../infra/db/schema/users";
import { ForbiddenError, ServiceUnavailableError } from "../../../http/errors";
import { logSecurityEvent, logger } from "../../../shared/logging/logger";
import {
  InvalidCredentialsError,
  LoginService,
  type Session,
} from "../login.service";
import {
  GOOGLE_TOKEN_VERIFIER,
  GoogleUnavailableError,
  InvalidGoogleTokenError,
  type GoogleIdentity,
  type GoogleTokenVerifier,
} from "./google-verifier";

/**
 * P1-04 — sign in with Google. `docs/API/01` § Google OAuth.
 *
 * ## Where the identity comes from
 *
 * Entirely from `GoogleTokenVerifier`. This service is never given an email, a name or a
 * subject id by a caller — its only input is an opaque string that Google signed. That is
 * `docs/SECURITY/03`'s "NEVER trust the email from the request body" expressed as a
 * signature rather than as a rule to remember: there is no body field to trust.
 *
 * ## Matching, in the order the card's step 3 gives
 *
 * 1. **By `(oauth_provider, oauth_subject_id)`.** The subject id is stable for the life of
 *    a Google account and survives the user changing their address, which the email does
 *    not.
 * 2. **By verified email**, which links an existing password account.
 * 3. Otherwise register.
 *
 * ## Why an unverified Google email is refused outright
 *
 * A Google Workspace administrator can create an account on any address in a domain they
 * control, and Google reports `email_verified: false` for identities it has not confirmed.
 * If step 2 accepted those, anyone able to obtain such a token for `someone@gmail.com`
 * would take over that person's account here without ever seeing their password.
 *
 * So `email_verified: false` is refused for linking **and** for registration: an account
 * created on an unproven address is an account whose password-reset path belongs to
 * somebody else.
 */

/** Recorded on the session so the log can say what happened, and tests can assert it. */
export type OAuthOutcome = "registered" | "matched" | "linked";

export interface OAuthResult {
  readonly session: Session;
  readonly outcome: OAuthOutcome;
}

const PROVIDER = "google";

/** `docs/DATABASE/02`: `full_name VARCHAR(100)`. */
const MAX_NAME_LENGTH = 100;

@Injectable()
export class GoogleOAuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(GOOGLE_TOKEN_VERIFIER)
    private readonly verifier: GoogleTokenVerifier,
    private readonly logins: LoginService,
  ) {}

  async authenticate(idToken: string): Promise<OAuthResult> {
    const identity = await this.verify(idToken);

    const bySubject = await this.findBySubject(identity.subjectId);
    if (bySubject !== undefined) {
      return this.finish(bySubject, "matched");
    }

    // Everything past this point creates or modifies an account on the strength of an
    // email address, so Google's own verification of it is the precondition.
    if (!identity.emailVerified) {
      logSecurityEvent("auth.login_failed", {
        event_detail: "google_email_not_verified",
        provider: PROVIDER,
      });
      throw new ForbiddenError(
        "FORBIDDEN",
        "Google belum memverifikasi alamat email ini.",
      );
    }

    const byEmail = await this.findByEmail(identity.email);
    if (byEmail !== undefined) {
      return this.finish(await this.link(byEmail.id, identity), "linked");
    }

    return this.finish(await this.register(identity), "registered");
  }

  /**
   * Turn the verifier's two failure kinds into the two HTTP answers they deserve.
   *
   * A bad token is the user's problem and is `401`, with the same generic message a wrong
   * password gets. Google being unreachable is *our* problem and is `503` -- a `401` there
   * would send someone to a password form for an account that may not have a password.
   */
  private async verify(idToken: string): Promise<GoogleIdentity> {
    try {
      return await this.verifier.verify(idToken);
    } catch (error) {
      if (error instanceof InvalidGoogleTokenError) {
        logSecurityEvent("auth.login_failed", {
          provider: PROVIDER,
          // A fixed slug from a closed set -- `bad_signature`, `wrong_audience` and so
          // on. The verifier deliberately does not forward Google's own message, several
          // of which embed the id_token itself.
          reason: error.reason,
        });
        throw new InvalidCredentialsError();
      }
      if (error instanceof GoogleUnavailableError) {
        logger.error(
          {
            context: {
              event: "auth.oauth_provider_unavailable",
              provider: PROVIDER,
            },
          },
          "google sign-in could not be verified",
        );
        throw new ServiceUnavailableError(
          "Masuk dengan Google sedang tidak tersedia. Coba lagi sebentar lagi.",
        );
      }
      throw error;
    }
  }

  /**
   * Mint the session, after one last check on the row.
   *
   * `LoginService.issueSession` does not check status -- it is also called by
   * `P1-05` after a password reset, where the caller has already established it. So the
   * check is here, where the account may have been suspended at any point.
   */
  private async finish(
    row: UserRow,
    outcome: OAuthOutcome,
  ): Promise<OAuthResult> {
    if (row.status !== "active") {
      throw new ForbiddenError(
        "FORBIDDEN",
        "Akun ini dinonaktifkan. Hubungi dukungan pelanggan.",
      );
    }

    logger.info(
      {
        context: {
          user_id: row.id,
          event: "auth.oauth_login",
          provider: PROVIDER,
          outcome,
        },
      },
      "google sign-in",
    );

    return {
      session: await this.logins.issueSession({
        id: row.id,
        email: row.email,
        fullName: row.fullName,
        role: row.role,
        emailVerified: row.emailVerified,
      }),
      outcome,
    };
  }

  private async findBySubject(subjectId: string): Promise<UserRow | undefined> {
    const rows = await this.db
      .select(USER_COLUMNS)
      .from(users)
      .where(
        and(
          eq(users.oauthProvider, PROVIDER),
          eq(users.oauthSubjectId, subjectId),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);

    return rows[0];
  }

  private async findByEmail(email: string): Promise<UserRow | undefined> {
    const rows = await this.db
      .select(USER_COLUMNS)
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    return rows[0];
  }

  /**
   * Attach a Google identity to an account that already exists.
   *
   * `email_verified` becomes true: Google has confirmed the address, which is exactly what
   * our own verification email would have established (`docs/API/01` § Google OAuth).
   *
   * `password_hash` is left alone. The user may still have one and may still want it --
   * linking a sign-in method must not remove one.
   */
  private async link(
    userId: string,
    identity: GoogleIdentity,
  ): Promise<UserRow> {
    const [row] = await this.db
      .update(users)
      .set({
        oauthProvider: PROVIDER,
        oauthSubjectId: identity.subjectId,
        emailVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning(USER_COLUMNS);

    return row!;
  }

  private async register(identity: GoogleIdentity): Promise<UserRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          email: identity.email,
          // NULL, deliberately. `docs/DATABASE/02` makes the column nullable for exactly
          // this; a placeholder hash would be a value some later path tries to verify.
          passwordHash: null,
          fullName: displayName(identity),
          emailVerified: true,
          oauthProvider: PROVIDER,
          oauthSubjectId: identity.subjectId,
        })
        .returning(USER_COLUMNS);

      // Same as P1-02: created here so no later query defends against its absence.
      await tx.insert(userNotificationPreferences).values({ userId: row!.id });

      return row!;
    });
  }
}

const USER_COLUMNS = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  role: users.role,
  status: users.status,
  emailVerified: users.emailVerified,
} as const;

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  emailVerified: boolean;
}

/**
 * A name for the account.
 *
 * Google need not supply one, and `full_name` is `NOT NULL`. The local part of the address
 * is a poor name and a much better default than an empty string, which would render as a
 * blank byline on a published invitation.
 *
 * Trimmed and truncated only. Full sanitization is `P1-16`, which owns every free-text
 * field at once -- doing a partial version here would be a second implementation to keep
 * in step.
 */
function displayName(identity: GoogleIdentity): string {
  const candidate = identity.name ?? identity.email.split("@")[0] ?? "Pengguna";

  return candidate.trim().slice(0, MAX_NAME_LENGTH) || "Pengguna";
}
