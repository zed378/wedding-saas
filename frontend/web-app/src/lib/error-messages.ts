import { ApiError, NetworkError } from "@wi/api-client";

/**
 * P1-20 step 5 — turning an API failure into something a person can act on.
 *
 * Two rules shape everything here.
 *
 * **The message says what to do next.** "Terjadi kesalahan" is true and useless. A rate
 * limit means wait; an expired link means request a new one; wrong credentials mean try
 * again. A user who cannot tell which of those happened will retry the one that cannot work.
 *
 * **The wording never distinguishes what the server refuses to distinguish.**
 * `docs/API/01` § Error Cases makes `INVALID_CREDENTIALS` deliberately ambiguous between a
 * wrong password and an unknown address, and `P1-02` gives registration a uniform response
 * for a duplicate email. A frontend that helpfully said "we don't know that address" would
 * hand back the enumeration oracle the backend spent two tasks removing — from the one
 * screen where it is most useful to an attacker.
 */

export interface FriendlyError {
  /** Shown to the user. Indonesian, actionable, never a code. */
  readonly message: string;
  /** When set, the field to attach it to and move focus into. */
  readonly field?: string;
  /** Seconds to wait, for a 429 that told us. */
  readonly retryAfterSeconds?: number;
  /** The link is dead and the screen should offer to send another. */
  readonly canResend?: boolean;
}

const GENERIC: FriendlyError = {
  message: "Terjadi kesalahan. Silakan coba lagi sebentar lagi.",
};

/**
 * `code` → message, for the codes the auth endpoints actually return.
 *
 * A table rather than a chain of `if`s so that an unhandled code is visible as an absence
 * rather than as whichever branch happened to catch it last.
 */
const BY_CODE: Readonly<Record<string, FriendlyError>> = {
  INVALID_CREDENTIALS: {
    // One message for both halves, matching the server. See the note above.
    message: "Email atau kata sandi salah.",
  },
  TOO_MANY_ATTEMPTS: {
    message: "Terlalu banyak percobaan. Tunggu sebentar sebelum mencoba lagi.",
  },
  EMAIL_NOT_VERIFIED: {
    message:
      "Verifikasi alamat email Anda terlebih dahulu. Cek kotak masuk untuk tautan verifikasi.",
    canResend: true,
  },
  UNAUTHENTICATED: {
    message: "Sesi Anda telah berakhir. Silakan masuk kembali.",
  },
  WEAK_PASSWORD: {
    message: "Kata sandi belum memenuhi syarat.",
    field: "password",
  },
  FREE_DRAFT_LIMIT_REACHED: {
    message:
      "Anda masih memiliki undangan yang belum dibayar. Selesaikan undangan tersebut terlebih dahulu.",
  },
};

/**
 * Turn anything thrown by the API client into something a screen can render.
 *
 * Handles the three shapes a request can fail in — an API error with a code, a transport
 * failure, and an unexpected throw — because a screen that only handled the first would show
 * a blank form to a user with no network and no explanation at all.
 */
export function toFriendlyError(error: unknown): FriendlyError {
  if (error instanceof NetworkError) {
    return {
      message:
        "Tidak dapat terhubung. Periksa koneksi internet Anda lalu coba lagi.",
    };
  }

  if (!(error instanceof ApiError)) return GENERIC;

  const known = BY_CODE[error.code];
  if (known !== undefined) {
    const wait = retryAfter(error);
    // Computed once and spread conditionally: `exactOptionalPropertyTypes` makes an
    // explicit `retryAfterSeconds: undefined` a different thing from an absent one, and the
    // screens check for absence.
    return wait === undefined ? known : { ...known, retryAfterSeconds: wait };
  }

  // A validation error carries per-field detail from `docs/API/00`'s envelope, and the
  // server already wrote those messages for a user to read. Using the first one attaches
  // the error to the field that caused it, which is what `docs/UI-UX/17` asks for: the
  // message belongs beside the input, not in a banner above the form.
  const detail = error.details?.[0];
  if (detail !== undefined) {
    return { message: detail.message, field: detail.field };
  }

  // The server's own message, when it has one. These are written in Indonesian by the
  // service layer and are safe to show — `docs/SECURITY/08` § Error Handling is what keeps
  // internals out of them.
  return error.message.length > 0 ? { message: error.message } : GENERIC;
}

/**
 * Seconds until the rate limit lifts, when the response said.
 *
 * `docs/SECURITY/10` asks the limiter to return `Retry-After`. Without it the screen still
 * says "wait a moment", which is honest but vaguer — so this is read where available and
 * absent where not, rather than guessed.
 */
function retryAfter(error: ApiError): number | undefined {
  const raw = error.retryAfterSeconds;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? Math.ceil(raw)
    : undefined;
}

/** `120` → `"2 menit"`, for a wait hint somebody can act on. */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${String(seconds)} detik`;
  const minutes = Math.ceil(seconds / 60);
  return `${String(minutes)} menit`;
}
