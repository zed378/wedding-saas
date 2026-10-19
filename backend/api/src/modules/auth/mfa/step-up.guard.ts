import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
} from "@nestjs/common";
import { ForbiddenError } from "../../../http/errors";
import { maybeCurrentUser } from "../../../shared/auth-middleware/current-user";
import { MfaService } from "./mfa.service";

/**
 * docs/SECURITY/03 § Admin Session:
 * Re-authentication (step-up) is required for highly sensitive actions
 * (e.g., manual refunds, user suspensions).
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly mfa: MfaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user ?? maybeCurrentUser(req);

    if (!user || !user.id) {
      throw new ForbiddenError(
        "FORBIDDEN",
        "Autentikasi diperlukan sebelum melakukan tindakan ini.",
      );
    }

    // Check step-up token from header X-MFA-Step-Up
    const stepUpToken = req.headers["x-mfa-step-up"];
    if (typeof stepUpToken === "string" && stepUpToken.length > 0) {
      const isValid = await this.mfa.verifyStepUpToken(stepUpToken, user.id);
      if (isValid) return true;
    }

    // Alternatively check if step_up_code is passed directly in body
    const candidateCode = req.body?.step_up_code;
    if (typeof candidateCode === "string" && candidateCode.length > 0) {
      const res = await this.mfa.verifyCodeOrRecovery(user.id, {
        code: candidateCode,
      });
      if (res.success) return true;
    }

    throw new ForbiddenError(
      "MFA_STEP_UP_REQUIRED",
      "Tindakan berisiko tinggi memerlukan verifikasi ulang 2FA (Step-up authentication). Masukkan kode TOTP terbaru.",
    );
  }
}
