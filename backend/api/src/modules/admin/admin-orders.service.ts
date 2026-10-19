import { Inject, Injectable, Optional } from "@nestjs/common";
import { and, count, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import {
  auditLogs,
  invitations,
  invoices,
  orders,
  paymentNotifications,
  payments,
  users,
} from "../../infra/db/schema/index";
import { ConflictError, NotFoundError, ValidationError } from "../../http/errors";
import type { PageMeta } from "../../http/envelope";
import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import type { CurrentUser } from "../../shared/auth-middleware/current-user";
import { PublicInvitationCache } from "../publishing/public-invitation-cache";
import { InvitationStatusService } from "../../shared/invitation-status/invitation-status.service";
import type { AdminOrderQueryDto } from "./schemas/admin-order.schema";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AdminOrderSummaryItem {
  id: string;
  invitationId: string;
  userId: string;
  packageId: string;
  addonIds: string[];
  amountTotal: string;
  status: string;
  orderType: string;
  userEmail: string;
  userFullName: string;
  invitationSlug: string;
  createdAt: string;
  expiredAt: string;
  paymentCount: number;
}

export interface AdminOrderPaymentItem {
  id: string;
  provider: string;
  providerReferenceId: string;
  method: string | null;
  amount: string;
  status: string;
  signatureValid: boolean | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface AdminPaymentNotificationItem {
  id: string;
  source: string;
  provider: string;
  claimedReference: string | null;
  signatureValid: boolean;
  rejectionReason: string | null;
  outcome: string | null;
  providerStatus: string | null;
  amount: string | null;
  result: string | null;
  needsReview: boolean;
  receivedAt: string;
  processedAt: string | null;
}

export interface AdminOrderDetailItem {
  id: string;
  invitationId: string;
  userId: string;
  packageId: string;
  addonIds: string[];
  amountTotal: string;
  status: string;
  orderType: string;
  createdAt: string;
  updatedAt: string;
  expiredAt: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    phone: string | null;
  };
  invitation: {
    id: string;
    slug: string;
    internalName: string | null;
  };
  payments: AdminOrderPaymentItem[];
  notifications: AdminPaymentNotificationItem[];
  hasFraudAlert: boolean;
  invoice: {
    number: string;
    generatedAt: string;
  } | null;
}

/**
 * P5-07, P5-08: Administrative Order and Payment Management Service.
 * docs/PLAN/12-ADMIN-PANEL.md § Order & Payment Management
 * docs/API/09-ADMIN-API.md § Order & Payment Management
 */
@Injectable()
export class AdminOrdersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly statusService: InvitationStatusService,
    @Optional() @Inject(JOB_QUEUE) private readonly queue?: JobQueue,
    @Optional() private readonly cache?: PublicInvitationCache,
  ) {}

  async listOrders(
    query: AdminOrderQueryDto,
  ): Promise<{ data: AdminOrderSummaryItem[]; meta: PageMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];

    if (query.status && query.status !== "all") {
      conditions.push(eq(orders.status, query.status));
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      const searchConditions: SQL[] = [
        ilike(users.email, `%${term}%`),
        ilike(users.fullName, `%${term}%`),
        ilike(invitations.slug, `%${term}%`),
      ];
      if (UUID_REGEX.test(term)) {
        searchConditions.push(eq(orders.id, term));
      }
      conditions.push(or(...searchConditions)!);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Count total matching orders
    const [totalRow] = await this.db
      .select({ total: count() })
      .from(orders)
      .leftJoin(users, eq(orders.userId, users.id))
      .leftJoin(invitations, eq(orders.invitationId, invitations.id))
      .where(whereClause);

    const total = Number(totalRow?.total ?? 0);

    // Fetch order rows
    const orderRows = await this.db
      .select({
        id: orders.id,
        invitationId: orders.invitationId,
        userId: orders.userId,
        packageId: orders.packageId,
        addonIds: orders.addonIds,
        amountTotal: orders.amountTotal,
        status: orders.status,
        orderType: orders.orderType,
        expiredAt: orders.expiredAt,
        createdAt: orders.createdAt,
        userEmail: users.email,
        userFullName: users.fullName,
        invitationSlug: invitations.slug,
      })
      .from(orders)
      .leftJoin(users, eq(orders.userId, users.id))
      .leftJoin(invitations, eq(orders.invitationId, invitations.id))
      .where(whereClause)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);

    const orderIds = orderRows.map((o) => o.id);

    // Aggregate payment attempt counts
    const paymentCountMap = new Map<string, number>();
    if (orderIds.length > 0) {
      const pCounts = await this.db
        .select({
          orderId: payments.orderId,
          total: count(),
        })
        .from(payments)
        .where(inArray(payments.orderId, orderIds))
        .groupBy(payments.orderId);

      for (const row of pCounts) {
        if (row.orderId) {
          paymentCountMap.set(row.orderId, Number(row.total));
        }
      }
    }

    const data: AdminOrderSummaryItem[] = orderRows.map((o) => ({
      id: o.id,
      invitationId: o.invitationId,
      userId: o.userId,
      packageId: o.packageId,
      addonIds: o.addonIds ?? [],
      amountTotal: o.amountTotal.toString(),
      status: o.status,
      orderType: o.orderType,
      userEmail: o.userEmail ?? "",
      userFullName: o.userFullName ?? "",
      invitationSlug: o.invitationSlug ?? "",
      createdAt: o.createdAt.toISOString(),
      expiredAt: o.expiredAt.toISOString(),
      paymentCount: paymentCountMap.get(o.id) ?? 0,
    }));

    return {
      data,
      meta: {
        page,
        per_page: limit,
        total,
      },
    };
  }

  async getOrder(id: string): Promise<AdminOrderDetailItem> {
    if (!UUID_REGEX.test(id)) {
      throw new NotFoundError(`Order "${id}" tidak ditemukan.`);
    }

    const [orderRow] = await this.db
      .select({
        id: orders.id,
        invitationId: orders.invitationId,
        userId: orders.userId,
        packageId: orders.packageId,
        addonIds: orders.addonIds,
        amountTotal: orders.amountTotal,
        status: orders.status,
        orderType: orders.orderType,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        expiredAt: orders.expiredAt,
        userIdActual: users.id,
        userEmail: users.email,
        userFullName: users.fullName,
        userPhone: users.phone,
        invitationIdActual: invitations.id,
        invitationSlug: invitations.slug,
        invitationInternalName: invitations.internalName,
      })
      .from(orders)
      .leftJoin(users, eq(orders.userId, users.id))
      .leftJoin(invitations, eq(orders.invitationId, invitations.id))
      .where(eq(orders.id, id))
      .limit(1);

    if (!orderRow) {
      throw new NotFoundError(`Order "${id}" tidak ditemukan.`);
    }

    // 1. Fetch payments for this order (redacting rawCallbackPayload)
    const paymentRows = await this.db
      .select({
        id: payments.id,
        provider: payments.provider,
        providerReferenceId: payments.providerReferenceId,
        method: payments.method,
        amount: payments.amount,
        status: payments.status,
        signatureValid: payments.signatureValid,
        verifiedAt: payments.verifiedAt,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(eq(payments.orderId, id))
      .orderBy(payments.createdAt);

    const paymentItems: AdminOrderPaymentItem[] = paymentRows.map((p) => ({
      id: p.id,
      provider: p.provider,
      providerReferenceId: p.providerReferenceId,
      method: p.method,
      amount: p.amount.toString(),
      status: p.status,
      signatureValid: p.signatureValid,
      verifiedAt: p.verifiedAt ? p.verifiedAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
    }));

    // 2. Fetch payment notifications (timeline)
    const paymentIds = paymentRows.map((p) => p.id);
    const providerRefs = paymentRows.map((p) => p.providerReferenceId).filter(Boolean);

    const notificationConditions: SQL[] = [];
    if (paymentIds.length > 0) {
      notificationConditions.push(inArray(paymentNotifications.paymentId, paymentIds));
    }
    if (providerRefs.length > 0) {
      notificationConditions.push(inArray(paymentNotifications.claimedReference, providerRefs));
    }

    let notificationRows: any[] = [];
    if (notificationConditions.length > 0) {
      notificationRows = await this.db
        .select({
          id: paymentNotifications.id,
          source: paymentNotifications.source,
          provider: paymentNotifications.provider,
          claimedReference: paymentNotifications.claimedReference,
          signatureValid: paymentNotifications.signatureValid,
          rejectionReason: paymentNotifications.rejectionReason,
          outcome: paymentNotifications.outcome,
          providerStatus: paymentNotifications.providerStatus,
          amount: paymentNotifications.amount,
          result: paymentNotifications.result,
          needsReview: paymentNotifications.needsReview,
          receivedAt: paymentNotifications.receivedAt,
          processedAt: paymentNotifications.processedAt,
        })
        .from(paymentNotifications)
        .where(or(...notificationConditions))
        .orderBy(paymentNotifications.receivedAt);
    }

    const notificationItems: AdminPaymentNotificationItem[] = notificationRows.map((n) => ({
      id: n.id,
      source: n.source,
      provider: n.provider,
      claimedReference: n.claimedReference,
      signatureValid: n.signatureValid,
      rejectionReason: n.rejectionReason,
      outcome: n.outcome,
      providerStatus: n.providerStatus,
      amount: n.amount != null ? n.amount.toString() : null,
      result: n.result,
      needsReview: n.needsReview,
      receivedAt: n.receivedAt.toISOString(),
      processedAt: n.processedAt ? n.processedAt.toISOString() : null,
    }));

    // 3. Fraud check: any notification with signatureValid === false or signature_mismatch
    const hasFraudAlert = notificationItems.some(
      (n) => n.signatureValid === false || n.rejectionReason === "signature_mismatch",
    );

    // 4. Fetch invoice if generated
    const [invoiceRow] = await this.db
      .select({
        number: invoices.number,
        generatedAt: invoices.generatedAt,
      })
      .from(invoices)
      .where(eq(invoices.orderId, id))
      .limit(1);

    const invoice = invoiceRow
      ? {
          number: invoiceRow.number,
          generatedAt: invoiceRow.generatedAt.toISOString(),
        }
      : null;

    return {
      id: orderRow.id,
      invitationId: orderRow.invitationId,
      userId: orderRow.userId,
      packageId: orderRow.packageId,
      addonIds: orderRow.addonIds ?? [],
      amountTotal: orderRow.amountTotal.toString(),
      status: orderRow.status,
      orderType: orderRow.orderType,
      createdAt: orderRow.createdAt.toISOString(),
      updatedAt: orderRow.updatedAt.toISOString(),
      expiredAt: orderRow.expiredAt.toISOString(),
      user: {
        id: orderRow.userIdActual ?? orderRow.userId,
        email: orderRow.userEmail ?? "",
        fullName: orderRow.userFullName ?? "",
        phone: orderRow.userPhone ?? null,
      },
      invitation: {
        id: orderRow.invitationIdActual ?? orderRow.invitationId,
        slug: orderRow.invitationSlug ?? "",
        internalName: orderRow.invitationInternalName ?? null,
      },
      payments: paymentItems,
      notifications: notificationItems,
      hasFraudAlert,
      invoice,
    };
  }

  /**
   * P5-08: Manual Refund.
   * Single transaction:
   * - order status = 'refunded'
   * - invitation status = 'draft' (BR-5.4 & ADR-019)
   * - records invitation_status_history with admin as actor
   * - records audit_logs row
   * - immediately invalidates public invitation cache if previously published
   */
  async refundOrder(admin: CurrentUser, id: string, reason: string) {
    if (!UUID_REGEX.test(id)) {
      throw new NotFoundError(`Order "${id}" tidak ditemukan.`);
    }

    const trimmedReason = reason.trim();
    if (trimmedReason.length < 5) {
      throw new ValidationError([
        { field: "reason", message: "Alasan refund minimal 5 karakter." },
      ]);
    }

    const result = await this.db.transaction(async (tx) => {
      // 1. Fetch order under lock
      const [orderRow] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, id))
        .for("update");

      if (!orderRow) {
        throw new NotFoundError(`Order "${id}" tidak ditemukan.`);
      }

      if (orderRow.status !== "paid") {
        throw new ConflictError(
          "ORDER_NOT_PAID",
          `Hanya pesanan berstatus 'paid' yang dapat direfund (status saat ini: '${orderRow.status}').`,
        );
      }

      // 2. Fetch associated invitation under lock
      const [invitationRow] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.id, orderRow.invitationId))
        .for("update");

      if (!invitationRow) {
        throw new NotFoundError("Undangan terkait pesanan tidak ditemukan.");
      }

      const previousInvitationStatus = invitationRow.status;

      // 3. Demote order to 'refunded'
      await tx
        .update(orders)
        .set({
          status: "refunded",
          updatedAt: new Date(),
        })
        .where(eq(orders.id, id));

      // 4. Demote invitation to 'draft' (ADR-019 & BR-5.4) using InvitationStatusService
      await this.statusService.transitionWithin(
        tx,
        invitationRow.id,
        "draft",
        { kind: "ADMIN", userId: admin.id },
        `admin refund: ${trimmedReason}`,
      );

      // 6. Record audit log
      await tx.insert(auditLogs).values({
        adminId: admin.id,
        action: "order.refund",
        resourceType: "order",
        resourceId: id,
        reason: trimmedReason,
        beforeState: {
          order_status: "paid",
          invitation_status: previousInvitationStatus,
          amount_total: orderRow.amountTotal.toString(),
        },
        afterState: {
          order_status: "refunded",
          invitation_status: "draft",
        },
      });

      return {
        orderId: orderRow.id,
        status: "refunded" as const,
        invitationId: invitationRow.id,
        invitationSlug: invitationRow.slug,
        invitationStatus: "draft" as const,
        previousInvitationStatus,
        moneyMovement: "manual" as const,
        message:
          "Pesanan berhasil direfund di sistem dan status undangan dikembalikan ke draft. Pengembalian uang riil ke rekening/e-wallet pelanggan wajib diproses manual melalui dashboard gateway pembayaran (Midtrans).",
      };
    });

    // 7. Post-transaction cache invalidation if invitation was published
    if (result.previousInvitationStatus === "published" && result.invitationSlug) {
      if (this.cache) {
        await this.cache.invalidate({
          slug: result.invitationSlug,
          invitationId: result.invitationId,
        });
      }
      if (this.queue) {
        await this.queue.enqueue(
          "general",
          "cache.invalidate",
          {
            slug: result.invitationSlug,
            invitationId: result.invitationId,
            reason: "admin refund",
          },
          { relatedId: result.invitationId },
        );
      }
    }

    return result;
  }
}
