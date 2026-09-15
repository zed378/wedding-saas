import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import {
  CurrentUserParam,
  requireAuth,
  type CurrentUser,
} from "../../shared/auth-middleware";
import { rateLimit } from "../../shared/rate-limit";
import { pageMeta, parsePagination } from "../../http/pagination";
import { InvoiceService } from "./invoice/invoice.service";
import { OrderService } from "./order.service";

/**
 * `P3-02` — checkout. `docs/API/06`, `MEMORY/specs/P3-02-order-creation.md`.
 *
 * ## `.strict()`, so an amount is a 400
 *
 * The body is `package_id` and `addon_ids`, and nothing else is accepted. An `amount_total`
 * sent alongside is refused outright rather than dropped: `docs/SECURITY/07` § Pricing makes the
 * server the only source of a price, and a 400 tells whoever sent one that it was never going to
 * be used — where a silent drop would let a client believe for a while that it had been.
 *
 * Nothing in the body is free text. Both fields are catalogue identifiers matched against
 * `packages` and `addons`, and are registered in `NOT_USER_TEXT`.
 */

const ID = z.string().trim().min(1).max(30);

const createOrderSchema = z
  .object({
    package_id: ID,
    addon_ids: z.array(ID).max(10).default([]),
  })
  .strict();

const listQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    per_page: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

/** `docs/API/00` § Idempotency. Visible ASCII, bounded, so it can be hashed and logged safely. */
const idempotencyKeySchema = z
  .string()
  .regex(/^[\x21-\x7e]{1,255}$/, "Idempotency-Key tidak valid.");

@Controller("api/v1")
@UseGuards(requireAuth())
export class OrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly invoices: InvoiceService,
  ) {}

  /** `P3-08` — `GET /orders`, `docs/API/06`. Current status, newest first. */
  @Get("orders")
  @UseGuards(rateLimit("general-authenticated"))
  async list(
    @CurrentUserParam() user: CurrentUser,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed = parse(listQuerySchema, query);
    const pagination = parsePagination({
      ...(parsed.page !== undefined ? { page: parsed.page } : {}),
      ...(parsed.per_page !== undefined ? { per_page: parsed.per_page } : {}),
    });
    const { items, total } = await this.orders.list(user.scope, {
      limit: pagination.perPage,
      offset: pagination.offset,
    });
    return ok(items, pageMeta(pagination, total));
  }

  /** `P3-08` — `GET /orders/:order_id`. */
  @Get("orders/:order_id")
  @UseGuards(rateLimit("general-authenticated"))
  async detail(
    @CurrentUserParam() user: CurrentUser,
    @Param("order_id") orderId: string,
  ) {
    return ok(await this.orders.detail(user.scope, orderId));
  }

  /**
   * `P3-08` — `GET /orders/:order_id/invoice`: the PDF, to its owner, for a paid order only. Never cached
   * by anything in between: it carries a name and an email.
   */
  @Get("orders/:order_id/invoice")
  @UseGuards(rateLimit("general-authenticated"))
  async invoice(
    @CurrentUserParam() user: CurrentUser,
    @Param("order_id") orderId: string,
    @Res() res: Response,
  ): Promise<void> {
    const issued = await this.invoices.ownedInvoice(user.scope, orderId);
    res
      .status(200)
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${issued.number}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(issued.pdf);
  }

  @Post("invitations/:id/orders")
  @HttpCode(201)
  @UseGuards(rateLimit("general-authenticated"))
  async create(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") rawKey: string | undefined,
  ) {
    const input = parse(createOrderSchema, body);
    const idempotencyKey =
      rawKey === undefined ? undefined : parse(idempotencyKeySchema, rawKey);

    const order = await this.orders.create(user, id, {
      packageId: input.package_id,
      addonIds: input.addon_ids,
      idempotencyKey,
    });
    return ok(order);
  }
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ValidationError(
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    })),
  );
}
