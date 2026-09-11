import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";

import { ValidationError } from "../../http/errors";
import { ok } from "../../http/envelope";
import { RegistrationService } from "./registration.service";

/**
 * P1-02 — `docs/API/01` § Registration Flow.
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
  constructor(private readonly registration: RegistrationService) {}

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
}
