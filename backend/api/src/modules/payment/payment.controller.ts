import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import {
  CurrentUserParam,
  requireAuth,
  type CurrentUser,
} from "../../shared/auth-middleware";
import { rateLimit } from "../../shared/rate-limit";
import { PaymentService } from "./payment.service";

/**
 * `P3-04` — payment initiation. `docs/API/07`.
 *
 * The body is empty. Everything a payment needs — the amount above all — comes from the order row
 * (`docs/BACKEND/05`), so any field sent is refused rather than read.
 */
const emptyBody = z.object({}).strict();

@Controller("api/v1")
@UseGuards(requireAuth())
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post("orders/:order_id/payment")
  @HttpCode(201)
  @UseGuards(rateLimit("general-authenticated"))
  async initiate(
    @CurrentUserParam() user: CurrentUser,
    @Param("order_id") orderId: string,
    @Body() body: unknown,
  ) {
    const parsed = emptyBody.safeParse(body ?? {});
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "body",
          message: issue.message,
        })),
      );
    }

    return ok(
      await this.payments.initiate(
        { scope: user.scope, fullName: user.fullName, email: user.email },
        orderId,
      ),
    );
  }
}
