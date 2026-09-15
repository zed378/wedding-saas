import { describe, expect, it } from "vitest";

import {
  formatRupiah,
  invoiceNumber,
  renderInvoice,
  wibDate,
} from "../src/modules/order/invoice/invoice-document";
import { escapeText, renderPdf } from "../src/modules/order/invoice/simple-pdf";

/**
 * `P3-08`, ADR-079 — the hand-written PDF and the invoice drawn with it.
 *
 * A PDF viewer is forgiving; a cross-reference table with wrong offsets still often opens, and then does
 * not in the one viewer an accountant uses. So the structure is checked byte for byte: every offset in the
 * xref must land exactly on its object.
 */

function xrefOffsets(pdf: string): number[] {
  const start = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)![1]);
  const table = pdf.slice(start);
  return [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
}

describe("renderPdf", () => {
  const pdf = renderPdf({
    title: "T",
    texts: [{ x: 50, y: 50, text: "Halo (dunia)" }],
    lines: [{ x1: 50, y1: 60, x2: 100, y2: 60 }],
  }).toString("latin1");

  it("is a PDF 1.4 file with a trailer", () => {
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.endsWith("%%EOF\n")).toBe(true);
    expect(pdf).toContain("/Root 1 0 R");
  });

  it("has a cross-reference table whose every offset lands on its object", () => {
    const offsets = xrefOffsets(pdf);
    expect(offsets).toHaveLength(7);
    offsets.forEach((offset, index) => {
      expect(pdf.slice(offset, offset + 10)).toMatch(
        new RegExp(`^${String(index + 1)} 0 obj`),
      );
    });
    const start = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(start, start + 4)).toBe("xref");
  });

  it("declares the content stream's exact length", () => {
    const match = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(
      pdf,
    )!;
    expect(Number(match[1])).toBe(Buffer.byteLength(match[2]!, "latin1"));
  });

  it("escapes parentheses and backslashes, and replaces what WinAnsi cannot show", () => {
    expect(escapeText("a(b)c\\d")).toBe("a\\(b\\)c\\\\d");
    expect(escapeText("Budi 💍 殿")).toBe("Budi ? ?");
    expect(escapeText("Café ñ")).toBe("Café ñ");
    expect(pdf).toContain("(Halo \\(dunia\\)) Tj");
  });
});

describe("the invoice", () => {
  const paidAt = new Date("2027-05-14T20:30:00Z"); // 03:30 on 15 May in WIB

  it("dates and numbers it by the payment's day in WIB, not UTC", () => {
    expect(wibDate(paidAt)).toBe("2027-05-15");
    expect(invoiceNumber("7c1f2b3a-0000-4000-8000-000000000000", paidAt)).toBe(
      "INV-20270515-7C1F2B3A",
    );
  });

  it("formats rupiah with Indonesian separators", () => {
    expect(formatRupiah(139000n)).toBe("Rp 139.000");
    expect(formatRupiah(1234567n)).toBe("Rp 1.234.567");
    expect(formatRupiah(500n)).toBe("Rp 500");
  });

  it("carries what an invoice needs and nothing about the invitation", () => {
    const pdf = renderInvoice({
      number: "INV-20270515-7C1F2B3A",
      orderId: "7c1f2b3a-0000-4000-8000-000000000000",
      paidAt,
      seller: { name: "vizunicum.my.id", address: null },
      buyer: { name: "Budi Santoso", email: "budi@example.test" },
      lines: [{ label: "Paket Standard", amount: 139000n }],
      total: 139000n,
      paymentMethod: "bank_transfer",
      orderType: "new_publish",
    }).toString("latin1");

    for (const expected of [
      "(INV-20270515-7C1F2B3A)",
      "(15 Mei 2027)",
      "(7c1f2b3a-0000-4000-8000-000000000000)",
      "(Budi Santoso)",
      "(budi@example.test)",
      "(vizunicum.my.id)",
      "(Paket Standard)",
      "(Rp 139.000)",
      "(Publikasi)",
      "(LUNAS)",
    ]) {
      expect(pdf).toContain(expected);
    }
    expect(pdf).not.toMatch(/slug|mempelai|guest|tamu/i);
  });

  it("labels a renewal as one", () => {
    const pdf = renderInvoice({
      number: "N",
      orderId: "o",
      paidAt,
      seller: { name: "S", address: "Jl. Contoh 1" },
      buyer: { name: "B", email: "b@example.test" },
      lines: [{ label: "Paket Standard", amount: 1n }],
      total: 1n,
      paymentMethod: null,
      orderType: "renewal",
    }).toString("latin1");
    expect(pdf).toContain("(Perpanjangan)");
    expect(pdf).toContain("(Jl. Contoh 1)");
    expect(pdf).not.toContain("(Pembayaran)");
  });
});
