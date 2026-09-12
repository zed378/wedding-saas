import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { DB, type Database } from "../../infra/db/client";
import { users } from "../../infra/db/schema/users";
import { ForbiddenError, UnauthenticatedError } from "../../http/errors";
import { logSecurityEvent, logger } from "../../shared/logging/logger";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import { signAccessToken } from "./tokens/access-token.service";
import {
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  type IssuedRefreshToken,
} from "./tokens/refresh-token.service";
import { SessionService, type AuthenticatedUser } from "./session.service";

/**
 * P1-03 — login, refresh and logout. `docs/API/01` § Token Strategy.
 *
 * The controller owns the cookie and the HTTP status; everything that decides anything is
 * here, because `P1-04` (Google) and `P1-05` (reset) both need to mint a session and
 * neither of them arrives through this controller.
 */

export interface Session {
  readonly accessToken: string;
  readonly refresh: IssuedRefreshToken;
  readonly user: AuthenticatedUser;
}

/**
 * One error for "no such email" and for "wrong password".
 *
 * `docs/API/01` § Error Cases requires a generic message. This is a distinct class from
 * `UnauthenticatedError` only so the controller can attach the documented
 * `INVALID_CREDENTIALS` code; both are 401 and both carry the same text.
 */
export class InvalidCredentialsError extends UnauthenticatedError {
  constructor() {
    super("Email atau kata sandi salah.", "INVALID_CREDENTIALS");
    this.name = "InvalidCredentialsError";
  }
}

@Injectable()
export class LoginService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Exchange an email and password for a session.
   *
   * An unknown address costs the same as a wrong password: `verifyPassword` verifies
   * against a dummy hash when there is none, which is `P1-01`'s reason for existing and
   * has its own timing tests there. Returning early here would undo all of it.
   */
  async login(rawEmail: string, password: string): Promise<Session> {
    const email = rawEmail.trim().toLowerCase();

    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        status: users.status,
        emailVerified: users.emailVerified,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    const row = rows[0];
    const correct = await verifyPassword(row?.passwordHash, password);

    if (!correct) {
      // The email is hashed into the event. `P1-07` needs to count attempts per account
      // and the aggregator must not become a list of everyone who has ever mistyped a
      // password here (`docs/SECURITY/09`).
      logSecurityEvent("auth.login_failed", {
        email_sha256: createHash("sha256").update(email).digest("hex"),
        known_account: row !== undefined,
      });
      throw new InvalidCredentialsError();
    }

    // Correct password, unusable account. Distinct from the generic error on purpose: the
    // generic one defends against an attacker who does not know the password, and this
    // branch is only reachable by someone who does. See the spec, § 10.
    if (row!.status !== "active") {
      throw new ForbiddenError(
        "FORBIDDEN",
        "Akun ini dinonaktifkan. Hubungi dukungan pelanggan.",
      );
    }

    // P1-01 left this obligation on this card: login is the only moment the plaintext is
    // in hand, so it is the only moment the stored hash can be upgraded when the argon2
    // parameters move. Failure here must not fail the login -- the old hash still works.
    await this.rehashIfNeeded(row!.id, row!.passwordHash, password);

    return this.issueSession({
      id: row!.id,
      email: row!.email,
      fullName: row!.fullName,
      role: row!.role,
      emailVerified: row!.emailVerified,
    });
  }

  /**
   * Spend a refresh token, issue its successor, and mint a new access token.
   *
   * The user is re-read, so a suspension between two refreshes ends the session at the
   * next one rather than up to thirty days later.
   */
  async refresh(token: string | undefined): Promise<Session> {
    if (token === undefined || token.length === 0) {
      throw new UnauthenticatedError();
    }

    const result = await rotateRefreshToken(
      this.db,
      this.env.REFRESH_TOKEN_PEPPER,
      token,
    );

    if (result.status === "reuse_detected") {
      // The highest-signal event in the auth system: a token that was already spent has
      // been presented again, which means two parties held it. `docs/SECURITY/03`.
      logSecurityEvent(
        "auth.token_reuse_detected",
        {
          user_id: result.userId,
          sessions_revoked: result.revokedCount,
        },
        "error",
      );
      throw new UnauthenticatedError();
    }

    if (result.status === "invalid") throw new UnauthenticatedError();

    const user = await this.sessions.loadActiveUser(result.userId);
    if (user === undefined) {
      // Suspended or deleted between issuing and refreshing. The successor that
      // `rotateRefreshToken` just wrote is now unreachable -- it is tied to an account
      // that cannot authenticate -- but leaving it live would be a session that outlives
      // the suspension, so it is revoked rather than left to expire.
      await revokeRefreshToken(
        this.db,
        this.env.REFRESH_TOKEN_PEPPER,
        result.issued.token,
      );
      throw new UnauthenticatedError();
    }

    return {
      accessToken: await signAccessToken(this.env.JWT_SIGNING_KEY, {
        userId: user.id,
        role: user.role,
        emailVerified: user.emailVerified,
      }),
      refresh: result.issued,
      user,
    };
  }

  /**
   * Revoke one session server-side.
   *
   * Discarding the cookie is not logout: the token would still be accepted for thirty
   * days by anyone who had copied it. The card's step 8.
   */
  async logout(token: string | undefined): Promise<void> {
    if (token === undefined || token.length === 0) return;
    await revokeRefreshToken(this.db, this.env.REFRESH_TOKEN_PEPPER, token);
  }

  /** Mint a fresh session. `P1-04` and `P1-05` call this without a password. */
  async issueSession(user: AuthenticatedUser): Promise<Session> {
    const [accessToken, refresh] = await Promise.all([
      signAccessToken(this.env.JWT_SIGNING_KEY, {
        userId: user.id,
        role: user.role,
        emailVerified: user.emailVerified,
      }),
      issueRefreshToken(this.db, this.env.REFRESH_TOKEN_PEPPER, user.id),
    ]);

    return { accessToken, refresh, user };
  }

  private async rehashIfNeeded(
    userId: string,
    storedHash: string | null,
    password: string,
  ): Promise<void> {
    if (storedHash === null || !needsRehash(storedHash)) return;

    try {
      const upgraded = await hashPassword(password);
      await this.db
        .update(users)
        .set({ passwordHash: upgraded, updatedAt: new Date() })
        .where(eq(users.id, userId));

      logger.info(
        { context: { user_id: userId, event: "auth.password_rehashed" } },
        "password hash upgraded to current parameters",
      );
    } catch (error) {
      // The login is already decided. A failed upgrade means the next login tries again.
      logger.warn(
        {
          context: {
            user_id: userId,
            event: "auth.password_rehash_failed",
            reason: error instanceof Error ? error.name : "unknown",
          },
        },
        "could not upgrade password hash",
      );
    }
  }
}
