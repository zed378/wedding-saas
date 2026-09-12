import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import {
  CurrentUserParam,
  requireAuth,
  type CurrentUser,
} from "../../shared/auth-middleware";
import { clearRefreshCookie, readRefreshCookie } from "../auth/refresh-cookie";
import { UserService, type UserProfile } from "./user.service";

/**
 * P1-08 — `docs/API/02`.
 *
 * ## No route here has a parameter
 *
 * Every path is `/users/me`. `docs/API/02` § Object-Level Authorization asks for IDOR
 * prevention "by design", and the design is that there is no `:id` segment to tamper with
 * and no `user_id` field in any schema. The target is `CurrentUser.scope`, which came from
 * the authenticated database row.
 *
 * ## The schemas are `.strict()`
 *
 * `docs/BACKEND/03` § Field Whitelisting makes the validation schema double as the
 * whitelist. `.strict()` rather than Zod's default strip, because the two differ in a way
 * that matters here: stripping silently accepts a request that tried to set `role`, and
 * the caller learns nothing. Rejecting tells them, and tells us -- an unexpected field on
 * this endpoint is worth a 400 rather than a shrug.
 */

/**
 * Indonesian mobile format. `docs/API/02` § Validation points at `docs/BACKEND/03`, which
 * does not actually define one -- recorded as a spec gap in the P1-08 record.
 *
 * Accepts `+62`, `62` or a leading `0`, then 9 to 13 digits. `VARCHAR(20)` is the column.
 */
const PHONE = /^(?:\+62|62|0)8[1-9][0-9]{7,11}$/;

const updateProfileSchema = z
  .object({
    full_name: z.string().trim().min(2).max(100).optional(),
    // `null` clears it; an empty string is treated the same way by the service.
    phone: z
      .union([
        z.string().trim().regex(PHONE, "Nomor telepon tidak valid."),
        z.literal(""),
        z.null(),
      ])
      .optional(),
  })
  .strict();

const changePasswordSchema = z
  .object({
    old_password: z.string().min(1),
    // Unbounded: P1-01's policy owns length.
    new_password: z.string(),
  })
  .strict();

const preferencesSchema = z
  .object({
    rsvp_email: z.boolean().optional(),
    guestbook_email: z.boolean().optional(),
    marketing_email: z.boolean().optional(),
  })
  .strict();

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

/** `docs/API/02` § Example Response, field for field. */
function publicProfile(profile: UserProfile) {
  return {
    id: profile.id,
    email: profile.email,
    full_name: profile.fullName,
    phone: profile.phone,
    role: profile.role,
    email_verified: profile.emailVerified,
    created_at: profile.createdAt.toISOString(),
  };
}

@Controller("api/v1/users")
@UseGuards(requireAuth())
export class UserController {
  constructor(
    private readonly users: UserService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get("me")
  async me(@CurrentUserParam() user: CurrentUser) {
    return ok(publicProfile(await this.users.getProfile(user.scope)));
  }

  @Patch("me")
  async updateMe(@CurrentUserParam() user: CurrentUser, @Body() body: unknown) {
    const input = parse(updateProfileSchema, body);

    // Named properties, not a spread. A spread of `input` would carry whatever the schema
    // grows next straight into the update, and the whitelist would quietly stop being one.
    const updated = await this.users.updateProfile(user.scope, {
      ...(input.full_name !== undefined ? { fullName: input.full_name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
    });

    return ok(publicProfile(updated));
  }

  @Post("me/change-password")
  @HttpCode(200)
  async changePassword(
    @CurrentUserParam() user: CurrentUser,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const input = parse(changePasswordSchema, body);

    // The current session's refresh token is passed so it can be SPARED. The user is here
    // and authenticated; logging them out of the tab they are typing in costs usability
    // and buys nothing.
    const { sessionsRevoked } = await this.users.changePassword(
      user.scope,
      input.old_password,
      input.new_password,
      readRefreshCookie(req),
      this.env.REFRESH_TOKEN_PEPPER,
    );

    return ok({
      message:
        sessionsRevoked > 0
          ? `Kata sandi diperbarui. ${sessionsRevoked} sesi lain telah diakhiri.`
          : "Kata sandi diperbarui.",
      sessions_revoked: sessionsRevoked,
    });
  }

  @Get("me/notification-preferences")
  async preferences(@CurrentUserParam() user: CurrentUser) {
    const prefs = await this.users.getPreferences(user.scope);
    return ok({
      rsvp_email: prefs.rsvpEmail,
      guestbook_email: prefs.guestbookEmail,
      marketing_email: prefs.marketingEmail,
    });
  }

  @Patch("me/notification-preferences")
  async updatePreferences(
    @CurrentUserParam() user: CurrentUser,
    @Body() body: unknown,
  ) {
    const input = parse(preferencesSchema, body);

    const prefs = await this.users.updatePreferences(user.scope, {
      ...(input.rsvp_email !== undefined
        ? { rsvpEmail: input.rsvp_email }
        : {}),
      ...(input.guestbook_email !== undefined
        ? { guestbookEmail: input.guestbook_email }
        : {}),
      ...(input.marketing_email !== undefined
        ? { marketingEmail: input.marketing_email }
        : {}),
    });

    return ok({
      rsvp_email: prefs.rsvpEmail,
      guestbook_email: prefs.guestbookEmail,
      marketing_email: prefs.marketingEmail,
    });
  }

  /**
   * Request deletion. Soft delete, every session revoked, confirmation email.
   *
   * Published invitations keep serving until their own expiry (ADR-051, answering
   * `OQ-11`). The response says so, because a user who deletes their account and finds
   * their wedding page still up should have been told that was the intent.
   */
  @Delete("me")
  @HttpCode(200)
  async deleteMe(
    @CurrentUserParam() user: CurrentUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.users.requestDeletion(user.scope);

    // The session is already dead server-side; this stops the browser sending a value
    // that no longer works.
    clearRefreshCookie(res, this.env);

    return ok({
      status: result.status,
      live_invitations: result.liveInvitations,
      message:
        result.liveInvitations > 0
          ? `Akun Anda telah dinonaktifkan. ${result.liveInvitations} undangan yang sudah terbit akan tetap dapat diakses tamu hingga masa berlakunya berakhir.`
          : "Akun Anda telah dinonaktifkan.",
    });
  }
}
