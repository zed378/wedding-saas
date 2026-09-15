import { formatEventDate } from "@wi/schema";

import { renderPdf, type PdfLine, type PdfText } from "./simple-pdf";

/** Everything an invoice shows — and, by `P3-08` step 3, nothing else. */
export interface InvoiceData {
  readonly number: string;
  readonly orderId: string;
  /** When the payment was verified. */
  readonly paidAt: Date;
  readonly seller: { readonly name: string; readonly address: string | null };
  readonly buyer: { readonly name: string; readonly email: string };
  readonly lines: readonly {
    readonly label: string;
    readonly amount: bigint;
  }[];
  readonly total: bigint;
  readonly paymentMethod: string | null;
  readonly orderType: "new_publish" | "renewal" | string;
}

/** `Rp 1.234.567` — Indonesian thousands separator. Formatting, not a price: amounts come from rows. */
export function formatRupiah(amount: bigint): string {
  const digits = amount.toString();
  return `Rp ${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/** The payment's calendar date in WIB, as `YYYY-MM-DD`. Invoices are dated where the business is. */
export function wibDate(instant: Date): string {
  return new Date(instant.getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** `INV-20270515-7C1F2B3A`. */
export function invoiceNumber(orderId: string, paidAt: Date): string {
  return `INV-${wibDate(paidAt).replace(/-/g, "")}-${orderId.slice(0, 8).toUpperCase()}`;
}

/**
 * `P3-08` — the invoice as a PDF. Indonesian, one page.
 *
 * Contents per the card's step 3: invoice number and order id, date, what was bought (package and add-ons
 * with prices), total, buyer name and email, seller identity. Nothing about the invitation itself — no
 * couple's names, no slug, no guest data: an invoice is forwarded to accountants and employers.
 */
export function renderInvoice(data: InvoiceData): Buffer {
  const texts: PdfText[] = [];
  const lines: PdfLine[] = [];
  let y = 70;

  texts.push({ x: 50, y, text: data.seller.name, size: 16, bold: true });
  if (data.seller.address !== null) {
    y += 16;
    texts.push({ x: 50, y, text: data.seller.address, size: 9 });
  }
  texts.push({
    x: 400,
    y: 70,
    text: "INVOICE / KUITANSI",
    size: 13,
    bold: true,
  });
  texts.push({ x: 400, y: 88, text: "LUNAS", size: 11, bold: true });

  y = 130;
  const row = (label: string, value: string) => {
    texts.push({ x: 50, y, text: label, size: 10, bold: true });
    texts.push({ x: 170, y, text: value, size: 10 });
    y += 16;
  };
  row("Nomor", data.number);
  row("Tanggal", formatEventDate(wibDate(data.paidAt)));
  row("ID pesanan", data.orderId);
  row("Jenis", data.orderType === "renewal" ? "Perpanjangan" : "Publikasi");
  if (data.paymentMethod !== null) row("Pembayaran", data.paymentMethod);

  y += 10;
  row("Ditagihkan kepada", data.buyer.name);
  row("Email", data.buyer.email);

  y += 14;
  lines.push({ x1: 50, y1: y, x2: 545, y2: y });
  y += 16;
  texts.push({ x: 50, y, text: "Deskripsi", size: 10, bold: true });
  texts.push({ x: 440, y, text: "Jumlah", size: 10, bold: true });
  y += 8;
  lines.push({ x1: 50, y1: y, x2: 545, y2: y });
  y += 16;

  for (const item of data.lines) {
    texts.push({ x: 50, y, text: item.label, size: 10 });
    texts.push({ x: 440, y, text: formatRupiah(item.amount), size: 10 });
    y += 16;
  }

  y += 4;
  lines.push({ x1: 50, y1: y, x2: 545, y2: y });
  y += 18;
  texts.push({ x: 50, y, text: "Total", size: 11, bold: true });
  texts.push({
    x: 440,
    y,
    text: formatRupiah(data.total),
    size: 11,
    bold: true,
  });

  y += 40;
  texts.push({
    x: 50,
    y,
    // Deliberately no claim about legal validity: what an Indonesian invoice must carry is `OQ-29`.
    text: "Dokumen ini dibuat secara otomatis.",
    size: 8,
  });

  return renderPdf({ title: data.number, texts, lines });
}
