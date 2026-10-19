import {
  Controller,
  Get,
  HttpCode,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { requireAuth, requireRole } from "../../shared/auth-middleware/guards";
import { AdminOrdersService } from "./admin-orders.service";
import { adminOrderQuerySchema } from "./schemas/admin-order.schema";

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
 * P5-07: Administrative Order and Payment Controller.
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
}
