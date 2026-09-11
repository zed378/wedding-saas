/**
 * P0-22 — the error shapes the interceptor produces.
 *
 * `docs/API/00` § Response Envelope fixes the wire format:
 *
 * ```json
 * { "success": false,
 *   "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [ ... ] } }
 * ```
 *
 * Every failure a caller can see is one of the three classes below, so a screen can
 * answer "what do I show the user" with a `switch` rather than by inspecting a status
 * code it has to remember the meaning of.
 */

/** One field-level problem. `docs/API/00`: `details[]` of `{ field, message }`. */
export interface ApiErrorDetail {
  readonly field: string;
  readonly message: string;
}

/**
 * The server answered, and said no.
 *
 * `code` is the documented machine-readable code; `message` is already user-facing and
 * in Indonesian (`docs/BACKEND/03` § Error Messages: "clear enough to display directly
 * to the user without needing additional mapping on the frontend").
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: readonly ApiErrorDetail[];
  readonly requestId: string | undefined;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: readonly ApiErrorDetail[];
    requestId?: string | undefined;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? [];
    this.requestId = init.requestId;
  }

  /** 4xx that the user can act on: fix a field, pick a different slug. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  /**
   * 5xx. `docs/FRONTEND/08`: these get a generic toast, never the server's message.
   *
   * The server's 500 message is deliberately generic too (`docs/API/00`), but the client
   * must not depend on that — a proxy or a future handler could leak a stack trace into
   * it, and the client is the last place that can decide not to render it.
   */
  get isServerError(): boolean {
    return this.status >= 500;
  }
}

/**
 * The request never reached the server: offline, DNS failure, a dropped connection.
 *
 * Separate from `ApiError` because the user's action is different — "you appear to be
 * offline" rather than "that did not work". `docs/FRONTEND/08` asks for an offline
 * indicator specifically.
 */
export class NetworkError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "NetworkError";
    this.cause = cause;
  }
}

/**
 * The session is gone and could not be refreshed.
 *
 * A distinct type so the app shell can redirect to login once, from one place, rather
 * than every screen checking for a 401 it might handle differently.
 */
export class UnauthenticatedError extends Error {
  constructor(message = "Sesi Anda telah berakhir. Silakan masuk kembali.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}
