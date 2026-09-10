/**
 * The one response shape for the whole API. `docs/API/00` § Response Envelope.
 *
 * Verbatim from the document, including the `snake_case` field names -- `per_page`, not
 * `perPage`. The API contract is the boundary where this repository's TypeScript
 * conventions stop and the document's start, and a helpful rename here would be a
 * breaking change nobody agreed to.
 *
 * These are the only two shapes a client ever sees. A handler that builds its own object
 * is the thing this file exists to prevent, because two response shapes means every
 * consumer needs two code paths and the second one is always the one nobody tested.
 */

/** `docs/API/00`: `{ "page": 1, "per_page": 20, "total": 57 }`. */
export interface PageMeta {
  readonly page: number;
  readonly per_page: number;
  readonly total: number;
}

export interface SuccessEnvelope<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: PageMeta;
}

/** One entry per invalid field. `docs/API/00` § Error. */
export interface ErrorDetail {
  readonly field: string;
  readonly message: string;
}

export interface ErrorEnvelope {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: readonly ErrorDetail[];
  };
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

/** Wrap a payload. `meta` is omitted rather than set to undefined -- see below. */
export function ok<T>(data: T, meta?: PageMeta): SuccessEnvelope<T> {
  // Spread-or-nothing: `{ meta: undefined }` serialises to no key in JSON but is not the
  // same object in a test assertion, and `exactOptionalPropertyTypes` treats them as
  // different types. Keeping them genuinely absent avoids both problems.
  return meta === undefined
    ? { success: true, data }
    : { success: true, data, meta };
}

export function failure(
  code: string,
  message: string,
  details?: readonly ErrorDetail[],
): ErrorEnvelope {
  return {
    success: false,
    error:
      details === undefined ? { code, message } : { code, message, details },
  };
}
