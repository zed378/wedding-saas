/**
 * P1-17 — the synchronous half of `docs/SECURITY/06-FILE-UPLOAD-SECURITY.md`.
 *
 * Three of the five checks live here: the extension allowlist (layer 2), the advisory
 * `Content-Type` (layer 1), and the magic bytes (layer 3). The other two — size and quota —
 * need the request and the database.
 *
 * ## Why the bytes decide and nothing else does
 *
 * Both of the other signals are attacker-controlled. A filename is a string the client chose;
 * a `Content-Type` is a header the client typed. `docs/SECURITY/06` says the header is "NOT
 * FULLY TRUSTED" and lists trusting it alone under Prohibited. The leading bytes are the only
 * input here that the file itself has to satisfy, and layer 3 exists specifically to catch "a
 * webshell/script disguised as an image".
 *
 * The extension check is still worth running, and first: it is free, it rejects the
 * overwhelming majority of accidents, and `docs/BACKEND/04` Stage 1 orders the checks
 * cheapest-first for exactly that reason.
 *
 * ## No dependency
 *
 * `file-type` and friends detect hundreds of formats. Three are permitted here, their
 * signatures are four to twelve bytes, and the detection is ten lines. A library would add a
 * supply-chain surface to the one code path whose entire job is distrusting its input.
 */

/** The formats `docs/PLAN/11` § Limits per Package permits. */
export type ImageFormat = "jpeg" | "png" | "webp";

/** `docs/SECURITY/06` layer 2, verbatim. Compared lower-cased. */
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;

/** What each format's bytes must be, and what a browser calls it. */
const SIGNATURES: readonly {
  readonly format: ImageFormat;
  readonly mimeTypes: readonly string[];
  readonly matches: (bytes: Uint8Array) => boolean;
}[] = [
  {
    format: "jpeg",
    mimeTypes: ["image/jpeg", "image/jpg", "image/pjpeg"],
    // FF D8 FF. The fourth byte varies by JFIF/Exif/SPIFF variant, so it is not checked.
    matches: (b) =>
      b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    format: "png",
    mimeTypes: ["image/png"],
    // 89 P N G CR LF SUB LF. The CR/LF pair is in the signature on purpose -- it is how the
    // format detects a transfer that mangled line endings.
    matches: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    format: "webp",
    mimeTypes: ["image/webp"],
    // RIFF....WEBP -- a RIFF container whose four-byte form type is WEBP. Bytes 4-7 are the
    // chunk length and are deliberately not inspected: this stage does not parse structure,
    // and a length that disagrees with the body is P1-18's decoder's business.
    matches: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
];

/**
 * `true` when the filename ends in a permitted extension.
 *
 * Only the final extension is considered, which is the right reading here: the file is stored
 * under a UUID with no extension at all, so `shell.php.jpg` is not a double-extension attack
 * against this system — it is simply a `.jpg` claim that the magic-byte check will settle.
 * Rejecting it on the name would give a false sense that the name mattered.
 */
export function hasAllowedExtension(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return false;

  const extension = filename.slice(dot).toLowerCase();
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(extension);
}

/**
 * The format the *bytes* say this is, or `null`.
 *
 * `null` is the answer for everything that is not one of the three permitted formats — a GIF,
 * a PDF, a ZIP, a PHP script, an empty file, or four bytes of a JPEG that was truncated in
 * transit. The caller does not learn which, and neither does the client.
 */
export function detectFormat(bytes: Uint8Array): ImageFormat | null {
  return SIGNATURES.find((s) => s.matches(bytes))?.format ?? null;
}

/**
 * Whether the client's `Content-Type` agrees with the bytes.
 *
 * **Not a gate.** The upload is accepted or refused on the bytes alone; this exists so a
 * disagreement can be logged. A client sending `image/jpeg` for a PNG is usually a confused
 * browser, and a client sending it for something that is not an image at all has already been
 * refused by `detectFormat`. `docs/SECURITY/06` layer 1 asks for the header to be checked and
 * not trusted, which is precisely this shape: consulted, recorded, never decisive.
 */
export function contentTypeAgrees(
  declared: string | undefined,
  format: ImageFormat,
): boolean {
  if (declared === undefined) return false;

  const bare = declared.split(";")[0]!.trim().toLowerCase();
  return (
    SIGNATURES.find((s) => s.format === format)?.mimeTypes.includes(bare) ??
    false
  );
}

/** The canonical MIME type for a detected format, for `media.mime_type`. */
export function canonicalMimeType(format: ImageFormat): string {
  return SIGNATURES.find((s) => s.format === format)!.mimeTypes[0]!;
}
