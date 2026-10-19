import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import type { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { currentUser } from "../../shared/auth-middleware/current-user";
import { requireAuth, requireRole } from "../../shared/auth-middleware/guards";
import { StepUpGuard } from "../auth/mfa/step-up.guard";
import { AdminOrdersService } from "./admin-orders.service";
import {
  adminOrderQuerySchema,
  adminOrderRefundSchema,
} from "./schemas/admin-order.schema";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  throw new ValidationError(
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "query",
      message: issue.message,
    })),
  );
}

/**
 * P5-07, P5-08: Administrative Order and Payment Controller.
 * docs/API/09-ADMIN-API.md § Order & Payment Management
 */
@Controller("api/v1/admin/orders")
@UseGuards(requireAuth(), requireRole("admin", "super_admin"))
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get()
  @HttpCode(200)
  async list(@Query() rawQuery: unknown) {
    const query = parse(adminOrderQuerySchema, rawQuery);
    const result = await this.orders.listOrders(query);
    return ok(result.data, result.meta);
  }

  @Get(":id")
  @HttpCode(200)
  async get(@Param("id") id: string) {
    const order = await this.orders.getOrder(id);
    return ok(order);
  }

  /**
   * P5-08: Administrative manual refund.
   * Requires 2FA step-up re-authentication (StepUpGuard).
   * Atomically marks order refunded, resets invitation to draft (ADR-019),
   * records audit log, and invalidates public invitation cache.
   */
  @Post(":id/refund")
  @UseGuards(StepUpGuard)
  @HttpCode(200)
  async refund(
    @Param("id") id: string,
    @Body() rawBody: unknown,
    @Req() req: Request,
  ) {
    const admin = currentUser(req);
    const body = parse(adminOrderRefundSchema, rawBody);
    const result = await this.orders.refundOrder(admin, id, body.reason);
    return ok(result);
  }
}

