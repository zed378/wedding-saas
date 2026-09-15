import { Inject, Injectable } from "@nestjs/common";

import { ENV } from "../../../config/config.module";
import type { Env } from "../../../config/env.schema";
import { BusinessRuleError, NotFoundError } from "../../../http/errors";
import { logger } from "../../../shared/logging/logger";
import { OrderRepository } from "../../../shared/tenancy/order-repository";
import type { TenantScope } from "../../../shared/tenancy/tenant-scope";
import { invoiceNumber, renderInvoice } from "./invoice-document";
import { InvoiceRepository } from "./invoice.repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IssuedInvoice {
  readonly number: string;
  readonly pdf: Buffer;
}

/**
 * `P3-08` — invoices. ADR-079.
 *
 * **Generated after payment, outside the payment's transaction.** The webhook queues `invoice.generate`
 * after it commits; the API jobs process renders and stores it. A rendering failure therefore cannot touch
 * payment state (card DoD 4). If the job never ran, the owner's download generates it on the spot through
 * the same `generate` — the invoice is a function of the paid order, so producing it late produces the same
 * document.
 *
 * **Only for paid orders** (card DoD 1). Pending, expired, failed and refunded orders have none to serve.
 */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly orders: OrderRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Render and store the invoice for a paid order, once. Idempotent. */
  async generate(orderId: string): Promise<IssuedInvoice | null> {
    const existing = await this.invoices.findByOrder(orderId);
    if (existing !== null)
      return { number: existing.number, pdf: existing.pdf };

    const source = await this.invoices.source(orderId);
    if (
      source === null ||
      source.orderStatus !== "paid" ||
      source.paidAt === null
    ) {
      logger.warn(
        {
          context: {
            event: "invoice.not_generated",
            order_id: orderId,
            status: source?.orderStatus ?? null,
          },
        },
        "invoice not generated: the order is not paid",
      );
      return null;
    }

    const number = invoiceNumber(source.orderId, source.paidAt);
    const label =
      source.addonNames.length === 0
        ? `Paket ${source.packageName}`
        : `Paket ${source.packageName} + ${source.addonNames.join(", ")}`;

    const pdf = renderInvoice({
      number,
      orderId: source.orderId,
      paidAt: source.paidAt,
      seller: {
        name: this.env.INVOICE_SELLER_NAME,
        address: this.env.INVOICE_SELLER_ADDRESS ?? null,
      },
      buyer: { name: source.buyerName, email: source.buyerEmail },
      // One line at the order's snapshot total. Per-item prices at the time of purchase are not stored
      // (`orders.amount_total` is the snapshot, `docs/DATABASE/07`), and today's catalogue prices could
      // disagree with what was paid — an invoice must add up to the money that moved.
      lines: [{ label, amount: source.amountTotal }],
      total: source.amountTotal,
      paymentMethod: source.paymentMethod,
      orderType:
        source.orderType === "renewal" && source.renewsEarlierPurchase
          ? "renewal"
          : "new_publish",
    });

    await this.invoices.insertOnce({ orderId: source.orderId, number, pdf });
    logger.info(
      {
        context: {
          event: "invoice.generated",
          order_id: orderId,
          invoice_number: number,
        },
      },
      "invoice generated",
    );
    // Re-read: a concurrent generation may have inserted first, and the stored one is the issued one.
    const stored = await this.invoices.findByOrder(orderId);
    return stored === null ? null : { number: stored.number, pdf: stored.pdf };
  }

  /** `GET /orders/:order_id/invoice`: the owner's invoice for a paid order. */
  async ownedInvoice(
    scope: TenantScope,
    orderId: string,
  ): Promise<IssuedInvoice> {
    if (!UUID.test(orderId)) throw new NotFoundError();
    const order = await this.orders.findOwnedOrder(orderId, scope);
    if (order === null) throw new NotFoundError();
    if (order.status !== "paid") {
      throw new BusinessRuleError(
        "INVOICE_NOT_AVAILABLE",
        "Invoice tersedia setelah pesanan dibayar.",
      );
    }
    const issued = await this.generate(order.id);
    if (issued === null) throw new NotFoundError();
    return issued;
  }
}
