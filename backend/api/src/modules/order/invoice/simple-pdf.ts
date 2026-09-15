/**
 * `P3-08`, ADR-079 — a one-page, text-only PDF, with no dependency.
 *
 * An invoice here is a dozen lines of text. The specified library (`@react-pdf/renderer`, ADR-017) would
 * bring React, a layout engine and font loading into the API to draw them. This writes PDF 1.4 directly:
 * one page (A4), the built-in Helvetica and Helvetica-Bold (no font file to embed or license), text at
 * absolute positions, a correct cross-reference table.
 *
 * **Its limit, stated**: the built-in fonts use WinAnsi encoding, so a character outside it (a name in
 * a non-Latin script, an emoji) is replaced with `?`. Indonesian in Latin script is fully covered. An
 * invoice that must show other scripts needs an embedded font — at that point, a library.
 */

export interface PdfText {
  /** Points from the left edge. A4 is 595 × 842. */
  readonly x: number;
  /** Points from the TOP edge (converted to PDF's bottom-up coordinates here). */
  readonly y: number;
  readonly text: string;
  readonly size?: number;
  readonly bold?: boolean;
}

export interface PdfLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

export function renderPdf(content: {
  readonly title: string;
  readonly texts: readonly PdfText[];
  readonly lines?: readonly PdfLine[];
}): Buffer {
  const stream = [
    ...(content.lines ?? []).map(
      (line) =>
        `0.5 w ${num(line.x1)} ${num(PAGE_HEIGHT - line.y1)} m ${num(line.x2)} ${num(PAGE_HEIGHT - line.y2)} l S`,
    ),
    ...content.texts.map(
      (t) =>
        `BT /${t.bold === true ? "F2" : "F1"} ${num(t.size ?? 10)} Tf ${num(t.x)} ${num(PAGE_HEIGHT - t.y)} Td (${escapeText(t.text)}) Tj ET`,
    ),
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Title (${escapeText(content.title)}) /Producer (wedding-invitation) >>`,
  ];

  let body = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;

  return Buffer.from(body, "latin1");
}

/** PDF string escaping, and anything outside Latin-1's printable range becomes `?`. */
export function escapeText(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (char === "\\" || char === "(" || char === ")") {
      out += `\\${char}`;
    } else if (
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff)
    ) {
      out += char;
    } else {
      out += "?";
    }
  }
  return out;
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
