import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { ValidationError } from "../../http/errors";
import { ok } from "../../http/envelope";
import { RegistrationService } from "./registration.service";
import { LoginService, type Session } from "./login.service";
import { SessionService, type AuthenticatedUser } from "./session.service";
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from "./refresh-cookie";

/**
 * P1-02 and P1-03 — `docs/API/01`.
 *
 * Thin, per `docs/ARCHITECTURE/01`: parse, delegate, shape the envelope. Every decision
 * lives in `RegistrationService`, which is also what the publish and order services will
 * call -- a rule enforced in a controller is a rule that does not apply to anything but
 * HTTP.
 */

const registerSchema = z.object({
  // `z.email()` rather than a regex. 255 is the column width in docs/DATABASE/02.
  email: z.email().max(255),
  // NOT bounded here. P1-01's policy owns length, including the reason the maximum is
  // 128 rather than something smaller, and a second limit in a second place is a second
  // thing to keep in step.
  password: z.string(),
  full_name: z.string().trim().min(1).max(100),
});

const loginSchema = z.object({
  email: z.email().max(255),
  // No policy check and no length bound. The policy governs a password being SET; running
  // it here would lock out anyone whose stored password predates a rule change.
  password: z.string().min(1),
});

const verifySchema = z.object({ token: z.string().min(1).max(512) });
const resendSchema = z.object({ email: z.email().max(255) });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  throw new ValidationError(
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    })),
  );
}

@Controller("api/v1/auth")
export class AuthController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly logins: LoginService,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post("register")
  @HttpCode(201)
  async register(@Body() body: unknown) {
    const input = parse(registerSchema, body);

    const result = await this.registration.register({
      email: input.email,
      password: input.password,
      fullName: input.full_name,
    });

    if (result.status === "rejected") {
      throw new ValidationError(
        result.violations.map((v) => ({ field: v.field, message: v.message })),
      );
    }

    // Identical for a new address and an existing one. See RegistrationService.
    return ok({
      message:
        "Jika alamat email tersebut dapat digunakan, kami telah mengirim tautan verifikasi.",
    });
  }

  @Post("verify-email")
  @HttpCode(200)
  async verifyEmail(@Body() body: unknown) {
    const { token } = parse(verifySchema, body);
    const result = await this.registration.verifyEmail(token);

    if (result.status === "invalid") {
      throw new ValidationError(
        [{ field: "token", message: "Tautan verifikasi tidak valid." }],
        "Tautan verifikasi tidak valid.",
      );
    }

    if (result.status === "expired") {
      throw new ValidationError(
        [
          {
            field: "token",
            message:
              "Tautan verifikasi telah kedaluwarsa. Silakan minta tautan baru.",
          },
        ],
        "Tautan verifikasi telah kedaluwarsa.",
      );
    }

    // `verified` and `already_verified` are both successes. A user who clicks twice has
    // achieved what they wanted, and an error there would be a support ticket.
    return ok({ email_verified: true });
  }

  @Post("resend-verification")
  @HttpCode(200)
  async resendVerification(@Body() body: unknown) {
    const { email } = parse(resendSchema, body);
    await this.registration.resendVerification(email);

    return ok({
      message:
        "Jika alamat email tersebut terdaftar dan belum diverifikasi, kami telah mengirim tautan baru.",
    });
  }

  /**
   * `docs/API/01` § Example Response, verbatim: `access_token` and a `user` object.
   *
   * The refresh token is NOT in the body. It leaves only as a `Set-Cookie`, so the client
   * has no way to put it anywhere a script can read it back.
   */
  @Post("login")
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parse(loginSchema, body);
    const session = await this.logins.login(input.email, input.password);

    return this.respondWithSession(res, session);
  }

  /**
   * Rotate. The presented token is dead by the time this returns, whatever the outcome.
   *
   * Takes no body at all -- see `refresh-cookie.ts` for why the cookie is the only
   * channel.
   */
  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.logins.refresh(readRefreshCookie(req));

    return this.respondWithSession(res, session);
  }

  /**
   * Revoke this session server-side, then clear the cookie.
   *
   * Always 200, even with no cookie or an unknown one: "log me out" has no failure mode
   * worth reporting, and an error here would tell a caller whether a token was live.
   */
  @Post("logout")
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.logins.logout(readRefreshCookie(req));
    clearRefreshCookie(res, this.env);

    return ok({ message: "Anda telah keluar." });
  }

  /**
   * The current user, read from the database.
   *
   * `P1-06` will put this resolution in middleware and inject the user; until then the
   * one endpoint that needs it calls the service directly. The important property is
   * already true: `role` and `email_verified` here are the row's, never the token's
   * (`docs/SECURITY/01` § Elevation of Privilege).
   */
  @Get("me")
  @HttpCode(200)
  async me(@Headers("authorization") authorization: string | undefined) {
    const user = await this.sessions.authenticate(authorization);

    return ok({ user: publicUser(user) });
  }

  private respondWithSession(res: Response, session: Session) {
    setRefreshCookie(
      res,
      this.env,
      session.refresh.token,
      session.refresh.expiresAt,
    );

    return ok({
      access_token: session.accessToken,
      user: publicUser(session.user),
    });
  }
}

/**
 * The user object `docs/API/01` § Example Response defines.
 *
 * An explicit projection rather than spreading the row: `password_hash` and
 * `oauth_subject_id` live on the same record, and a spread is one schema change away from
 * serialising them.
 */
function publicUser(user: AuthenticatedUser) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.fullName,
    role: user.role,
    email_verified: user.emailVerified,
  };
}
