import {
  Body,
  Controller,
  Get,
  Header,
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
import { PaymentStatusService } from "./payment-status.service";

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
  constructor(
    private readonly payments: PaymentService,
    private readonly statuses: PaymentStatusService,
  ) {}

  /**
   * `P3-06` — `docs/API/07` § Status Polling. Display only: no body, no query, nothing that could carry
   * a status in. Private and cacheable for two seconds, so the page that polls after returning from the
   * payment page costs almost nothing.
   */
  @Get("orders/:order_id/payment/status")
  @Header("Cache-Control", "private, max-age=2")
  @UseGuards(rateLimit("general-authenticated"))
  async status(
    @CurrentUserParam() user: CurrentUser,
    @Param("order_id") orderId: string,
  ) {
    return ok(await this.statuses.status(user.scope, orderId));
  }

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
