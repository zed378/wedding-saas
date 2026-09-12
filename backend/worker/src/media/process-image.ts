import sharp from "sharp";

/**
 * P1-18 — `docs/SECURITY/06` layers 5, 6, 7 and 11, and `docs/BACKEND/04` Stage 2 steps 3-6.
 *
 * ## The order is the defence
 *
 * Read the header, refuse extreme dimensions, and only then decode. `metadata()` parses a
 * few hundred bytes; `resize()` allocates width × height × channels. A 40000 × 40000 PNG is
 * a 4.8 GB buffer and a 200 KB file — the decompression bomb in `docs/SECURITY/06` layer 5,
 * and the whole point is to answer it before the allocation rather than after.
 *
 * `limitInputPixels` is the second line, not the first. It is sharp's own cap and it throws
 * during decode; relying on it alone would mean the defence lives in a library option that a
 * future `{ limitInputPixels: false }` could remove in one word.
 *
 * ## EXIF
 *
 * sharp drops all metadata unless `withMetadata()` is called, so stripping is the default
 * here rather than a step. That is exactly why `media-process.itest.ts` reads the output
 * bytes back and asserts there is no EXIF: a default is the kind of thing a later "keep the
 * orientation" change reverses without anybody thinking about GPS. `docs/SECURITY/09` treats
 * a couple's home coordinates in a public photo as a privacy incident.
 *
 * `rotate()` is called first, deliberately. It applies the EXIF orientation to the pixels
 * before the metadata is discarded, so a portrait photo does not come out sideways — the
 * one piece of EXIF that has to survive, and it survives as geometry rather than as data.
 */

/** `docs/SECURITY/06` layer 5: "reject extreme dimensions (e.g., > 10000x10000px)". */
export const MAX_DIMENSION = 10_000;

/**
 * The hard ceiling handed to sharp's decoder.
 *
 * 10000 × 10000 is 100 megapixels, which is the largest image this product accepts. The
 * limit is stated in pixels rather than bytes because that is what a decoder allocates.
 */
export const MAX_INPUT_PIXELS = MAX_DIMENSION * MAX_DIMENSION;

/**
 * The variants, from `docs/BACKEND/04` step 6 and this card's step 5.
 *
 * Three, not four. `docs/ARCHITECTURE/05` § Path Structure lists `original | large |
 * thumbnail` and `docs/BACKEND/04` lists `thumbnail | medium | large`, which looks like a
 * conflict until `docs/PLAN/11` § Limits resolves it in its own words: "the retained
 * *original* is the **capped** original from the processing pipeline". That is `large`. So
 * `original` is another name for `large`, not a fourth file — and the raw upload is never
 * retained at all, which is what BR-8.2 asks for. Closes OQ-19 (ADR-055).
 */
export const VARIANT_PLAN = [
  { variant: "thumbnail", width: 300 },
  { variant: "medium", width: 800 },
  { variant: "large", width: 1600 },
] as const;

export type VariantName = (typeof VARIANT_PLAN)[number]["variant"];

export interface ProcessedVariant {
  readonly variant: VariantName;
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface ProcessedImage {
  /** The dimensions of the source, after orientation is applied. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly variants: readonly ProcessedVariant[];
}

/** The image cannot be processed and never will be. Do not retry. */
export class UnprocessableImageError extends Error {
  readonly reason: "dimensions" | "undecodable";

  constructor(reason: "dimensions" | "undecodable", message: string) {
    super(message);
    this.name = "UnprocessableImageError";
    this.reason = reason;
  }
}

/**
 * Header-only inspection. Cheap, and the gate the dimension check runs at.
 *
 * Separate from `processImage` so the refusal can be asserted to happen *before* any decode
 * — a test can call this alone and see the bomb rejected with no pixel buffer in sight.
 */
export async function inspect(
  bytes: Uint8Array,
): Promise<{ width: number; height: number }> {
  let metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: false }).metadata();
  } catch (cause) {
    throw new UnprocessableImageError(
      "undecodable",
      `the file could not be read as an image: ${String(cause)}`,
    );
  }

  const width = metadata.width;
  const height = metadata.height;

  if (typeof width !== "number" || typeof height !== "number") {
    throw new UnprocessableImageError(
      "undecodable",
      "the file has no readable dimensions",
    );
  }

  // `limitInputPixels: false` above is what makes this check meaningful: sharp is allowed to
  // READ the header of an enormous image so this code can refuse it with a reason, rather
  // than throwing a library error that reads the same as a corrupt file.
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new UnprocessableImageError(
      "dimensions",
      `${String(width)}x${String(height)} exceeds the ${String(MAX_DIMENSION)}px limit`,
    );
  }

  return { width, height };
}

/**
 * Inspect, then decode once and resize three times.
 *
 * "Decode once" is `docs/SECURITY/06` layer 11: "resize results derived from the
 * ALREADY-VALIDATED source file, not repeatedly reprocessed from the raw input". Each
 * variant is a separate sharp pipeline over the same validated buffer, and every one of them
 * carries the pixel limit — a pipeline without it would be a hole the size of the whole
 * defence.
 */
export async function processImage(bytes: Uint8Array): Promise<ProcessedImage> {
  const source = await inspect(bytes);

  const variants: ProcessedVariant[] = [];

  for (const plan of VARIANT_PLAN) {
    const pipeline = sharp(bytes, {
      limitInputPixels: MAX_INPUT_PIXELS,
      // Stream the source rather than holding a random-access copy. libvips uses markedly
      // less memory this way on large JPEGs, which is what the media pool's cap is for.
      sequentialRead: true,
    })
      // Applies the EXIF orientation to the pixels, before the metadata is discarded below.
      .rotate()
      .resize({
        width: plan.width,
        // Never upscale: a 200px photo blown up to 1600 is three times the bytes and no
        // more detail. `withoutEnlargement` means a small source simply stays small.
        withoutEnlargement: true,
        fit: "inside",
      })
      // No `withMetadata()`. That absence is the EXIF strip -- layer 7 -- and the test
      // named "every variant is free of EXIF, GPS included" is what keeps it absent.
      .webp({ quality: 82 });

    let output;
    try {
      output = await pipeline.toBuffer({ resolveWithObject: true });
    } catch (cause) {
      throw new UnprocessableImageError(
        "undecodable",
        `the file passed its header check and failed to decode: ${String(cause)}`,
      );
    }

    variants.push({
      variant: plan.variant,
      bytes: new Uint8Array(output.data),
      width: output.info.width,
      height: output.info.height,
    });
  }

  return {
    sourceWidth: source.width,
    sourceHeight: source.height,
    variants,
  };
}
