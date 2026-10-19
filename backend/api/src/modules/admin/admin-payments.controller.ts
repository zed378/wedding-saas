import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import { eq, or } from "drizzle-orm";
import type { Request } from "express";

import { DB, type Database } from "../../infra/db/client";
import { auditLogs, payments } from "../../infra/db/schema/index";
import { ok } from "../../http/envelope";
import { NotFoundError } from "../../http/errors";
import { currentUser } from "../../shared/auth-middleware/current-user";
import { requireAuth, requireRole } from "../../shared/auth-middleware/guards";
import { logSecurityEvent } from "../../shared/logging/logger";

/**
 * P5-03: Raw payment payload inspection.
 *
 * docs/API/09 § Admin-Specific Principles:
 * "`raw-log` payment data contains raw payment data -- access is restricted to certain
 * roles & logged for who accessed it (sensitive data access logging)."
 *
 * Step 6 of card:
 * "Restrict `GET /admin/payments/:id/raw-log` to a narrower role (`super_admin`) and
 * log every access as sensitive-data access."
 */
@Controller("api/v1/admin/payments")
@UseGuards(requireAuth(), requireRole("super_admin"))
export class AdminPaymentsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get(":id/raw-log")
  @HttpCode(200)
  async getRawPaymentLog(@Param("id") id: string, @Req() req: Request) {
    const admin = currentUser(req);

    const rows = await this.db
      .select({
        id: payments.id,
        orderId: payments.orderId,
        provider: payments.provider,
        providerReferenceId: payments.providerReferenceId,
        status: payments.status,
        rawCallbackPayload: payments.rawCallbackPayload,
        signatureValid: payments.signatureValid,
        verifiedAt: payments.verifiedAt,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(or(eq(payments.id, id), eq(payments.orderId, id)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError("Catatan pembayaran tidak ditemukan.");
    }

    const payment = rows[0]!;

    // 1. Audit trail in database
    await this.db.insert(auditLogs).values({
      adminId: admin.id,
      action: "payment.raw_log_read",
      resourceType: "payment",
      resourceId: payment.id,
      reason: "Super Admin access to raw provider payment callback payload",
      afterState: {
        payment_id: payment.id,
        order_id: payment.orderId,
        provider: payment.provider,
      },
    });

    // 2. High-priority security log
    logSecurityEvent("admin.sensitive_data_access", {
      admin_id: admin.id,
      admin_email: admin.email,
      resource: "payment.raw_log",
      payment_id: payment.id,
      order_id: payment.orderId,
    });

    return ok({
      payment_id: payment.id,
      order_id: payment.orderId,
      provider: payment.provider,
      provider_reference_id: payment.providerReferenceId,
      status: payment.status,
      signature_valid: payment.signatureValid,
      verified_at: payment.verifiedAt?.toISOString() ?? null,
      raw_callback_payload: payment.rawCallbackPayload,
    });
  }
}
