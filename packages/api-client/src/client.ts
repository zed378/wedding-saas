import {
  ApiError,
  NetworkError,
  UnauthenticatedError,
  type ApiErrorDetail,
} from "./errors.js";
import { accessTokenStore, type TokenStore } from "./token-store.js";

/**
 * P0-22 — the API client and its interceptor.
 *
 * `docs/FRONTEND/08` § Global Fetch Error Handling: "The API client
 * (packages/api-client) has a centralized interceptor: 401 → trigger a token refresh
 * flow or redirect to login; 5xx → a generic 'Something went wrong, please try again'
 * toast; network error → an offline indicator."
 *
 * Centralised is the operative word. Every screen that handled its own 401 would handle
 * it slightly differently, and the one that got it wrong would log the user out on a
 * transient failure.
 */

/** `docs/API/00` § Response Envelope. */
interface SuccessEnvelope<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: PaginationMeta;
}

interface ErrorEnvelope {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: readonly ApiErrorDetail[];
  };
}

export interface PaginationMeta {
  readonly page: number;
  readonly per_page: number;
  readonly total: number;
}

export interface ApiResult<T> {
  readonly data: T;
  readonly meta: PaginationMeta | undefined;
}

export interface RequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly body?: unknown;
  readonly query?: Readonly<
    Record<string, string | number | boolean | undefined>
  >;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  /** `docs/API/00` § Idempotency — sensitive POSTs accept this header. */
  readonly idempotencyKey?: string;
  /**
   * Skip the Authorization header and the refresh flow.
   *
   * For the public API (`docs/API/08`), which is unauthenticated by design, and for the
   * login and refresh calls themselves — a refresh that tried to refresh would recurse.
   */
  readonly anonymous?: boolean;
}

export interface ApiClientConfig {
  /** e.g. `https://app.vizunicum.my.id/api/v1`. From an env var, never hard-coded. */
  readonly baseUrl: string;
  readonly tokenStore?: TokenStore;
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Exchanges the HTTP-only refresh cookie for a new access token.
   *
   * Injected rather than implemented here because the endpoint belongs to `P1-03` and
   * this package must not guess its shape. Returning `undefined` means "the session is
   * genuinely over" and produces an `UnauthenticatedError`.
   */
  readonly refreshAccessToken?: () => Promise<string | undefined>;
  /** Called once when a session ends unrecoverably. The app shell redirects. */
  readonly onUnauthenticated?: () => void;
  /** Called for 5xx and network failures. The app shell shows a toast or an indicator. */
  readonly onTransportProblem?: (problem: TransportProblem) => void;
}

export type TransportProblem =
  | {
      readonly kind: "server";
      readonly status: number;
      readonly requestId: string | undefined;
    }
  | { readonly kind: "offline"; readonly cause: unknown };

const REQUEST_ID_HEADER = "x-request-id";

export class ApiClient {
  readonly #config: ApiClientConfig;
  readonly #fetch: typeof globalThis.fetch;
  readonly #tokens: TokenStore;

  /**
   * The in-flight refresh, shared by every request that hits a 401 at once.
   *
   * Without this, a dashboard that fires six requests on mount and gets six 401s would
   * run six refreshes. With a **rotating** refresh token (`docs/SECURITY/03`), five of
   * them present a token that the first one already consumed — which the server is
   * required to treat as token reuse, i.e. as a stolen token, and which revokes the
   * whole family. The user is logged out for loading their own dashboard.
   */
  #refreshing: Promise<string | undefined> | undefined;

  constructor(config: ApiClientConfig) {
    this.#config = config;
    this.#fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.#tokens = config.tokenStore ?? accessTokenStore;
  }

  get tokens(): TokenStore {
    return this.#tokens;
  }

  async request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResult<T>> {
    const response = await this.#send(path, options);

    // 401 -> refresh once, then replay exactly once. Never on an anonymous call.
    // The replay is written out rather than recursing, so there is no path on which a
    // 401 can trigger a second refresh -- which is the shape that turns an expired
    // session into an infinite request loop.
    if (response.status === 401 && options.anonymous !== true) {
      const token = await this.#refreshOnce();

      if (token === undefined) {
        this.#tokens.clear();
        this.#config.onUnauthenticated?.();
        throw new UnauthenticatedError();
      }

      const replayed = await this.#send(path, options);
      if (replayed.status === 401) {
        // The new token was rejected too. Refreshing again would loop.
        this.#tokens.clear();
        this.#config.onUnauthenticated?.();
        throw new UnauthenticatedError();
      }
      return this.#unwrap<T>(replayed);
    }

    return this.#unwrap<T>(response);
  }

  get<T>(path: string, options: Omit<RequestOptions, "method" | "body"> = {}) {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  post<T>(
    path: string,
    body?: unknown,
    options: Omit<RequestOptions, "method"> = {},
  ) {
    return this.request<T>(path, { ...options, method: "POST", body });
  }

  patch<T>(
    path: string,
    body?: unknown,
    options: Omit<RequestOptions, "method"> = {},
  ) {
    return this.request<T>(path, { ...options, method: "PATCH", body });
  }

  delete<T>(
    path: string,
    options: Omit<RequestOptions, "method" | "body"> = {},
  ) {
    return this.request<T>(path, { ...options, method: "DELETE" });
  }

  // ------------------------------------------------------------------ internals

  async #send(path: string, options: RequestOptions): Promise<Response> {
    const url = this.#url(path, options.query);

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...options.headers,
    };

    if (options.body !== undefined)
      headers["Content-Type"] = "application/json";
    if (options.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    if (options.anonymous !== true) {
      const token = this.#tokens.get();
      if (token !== undefined) headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      return await this.#fetch(url, {
        method: options.method ?? "GET",
        headers,
        // `body` and `signal` are spread in only when present rather than passed as
        // `undefined`. Under `exactOptionalPropertyTypes` a `RequestInit` with
        // `body: undefined` is not a `RequestInit` -- and a GET carrying an explicit
        // undefined body is a shape some fetch implementations treat as a body.
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        // The refresh token is an HTTP-only cookie (docs/FRONTEND/02), so it only
        // travels if credentials are included. Without this the refresh flow cannot
        // work at all -- and it would fail as a 401 loop rather than as an obvious bug.
        credentials: "include",
      });
    } catch (cause) {
      // An aborted request is the caller's own doing -- a cancelled search, an unmounted
      // component. Reporting it as "you appear to be offline" would be a lie the user
      // sees every time they type quickly.
      if (isAbort(cause)) throw cause;

      this.#config.onTransportProblem?.({ kind: "offline", cause });
      throw new NetworkError(
        "Tidak dapat terhubung ke server. Periksa koneksi Anda.",
        cause,
      );
    }
  }

  /** All concurrent 401s share one refresh. See `#refreshing`. */
  async #refreshOnce(): Promise<string | undefined> {
    if (this.#config.refreshAccessToken === undefined) return undefined;

    this.#refreshing ??= (async () => {
      try {
        const token = await this.#config.refreshAccessToken!();
        if (token !== undefined) this.#tokens.set(token);
        return token;
      } catch {
        // A refresh that throws is a refresh that failed. Swallowed deliberately: the
        // caller's job is to decide the session is over, and rethrowing here would
        // surface a network error where an authentication error belongs.
        return undefined;
      } finally {
        this.#refreshing = undefined;
      }
    })();

    return this.#refreshing;
  }

  async #unwrap<T>(response: Response): Promise<ApiResult<T>> {
    const requestId = response.headers.get(REQUEST_ID_HEADER) ?? undefined;

    // 204 and friends carry no body. `docs/API/00` documents 200 for DELETE, but a
    // proxy or a future endpoint may answer 204 and `json()` would throw on it.
    if (response.status === 204) {
      return { data: undefined as T, meta: undefined };
    }

    const body = await this.#parse(response, requestId);

    if (response.ok && isSuccessEnvelope<T>(body)) {
      return { data: body.data, meta: body.meta };
    }

    if (isErrorEnvelope(body)) {
      if (response.status >= 500) {
        this.#config.onTransportProblem?.({
          kind: "server",
          status: response.status,
          requestId,
        });
      }

      throw new ApiError({
        status: response.status,
        code: body.error.code,
        ...(body.error.details === undefined
          ? {}
          : { details: body.error.details }),
        ...(retryAfterSeconds(response) === undefined
          ? {}
          : { retryAfterSeconds: retryAfterSeconds(response) }),
        // docs/FRONTEND/08: 5xx gets a GENERIC message. The server's own 500 message is
        // generic too, but the client is the last place that can decide not to render
        // whatever a proxy put there.
        message:
          response.status >= 500
            ? "Terjadi kesalahan. Silakan coba lagi."
            : body.error.message,
        requestId,
      });
    }

    // A response that is neither envelope is a contract violation -- an HTML error page
    // from a proxy, most likely. Reported as a server error rather than parsed
    // hopefully, because guessing at an unknown shape is how a login page ends up
    // rendered inside a data table.
    this.#config.onTransportProblem?.({
      kind: "server",
      status: response.status,
      requestId,
    });
    throw new ApiError({
      status: response.status,
      code: "MALFORMED_RESPONSE",
      message: "Terjadi kesalahan. Silakan coba lagi.",
      requestId,
    });
  }

  async #parse(
    response: Response,
    requestId: string | undefined,
  ): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new ApiError({
        status: response.status,
        code: "MALFORMED_RESPONSE",
        message: "Terjadi kesalahan. Silakan coba lagi.",
        requestId,
      });
    }
  }

  #url(path: string, query: RequestOptions["query"]): string {
    const base = this.#config.baseUrl.replace(/\/+$/, "");
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${base}${suffix}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }
}

function isSuccessEnvelope<T>(body: unknown): body is SuccessEnvelope<T> {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { success?: unknown }).success === true &&
    "data" in body
  );
}

function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  if (typeof body !== "object" || body === null) return false;
  if ((body as { success?: unknown }).success !== false) return false;

  const error = (body as { error?: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function isAbort(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { name?: unknown }).name === "AbortError"
  );
}

/**
 * `Retry-After`, in seconds, when the server sent one. `P1-20`.
 *
 * The header is defined as either a delay in seconds or an HTTP date; this reads the delay
 * form, which is what `docs/SECURITY/10`'s limiter sends. A date form returns `undefined`
 * rather than being parsed hopefully — a clock-skewed client computing a negative wait would
 * tell the user to try again immediately, which is worse than telling them nothing.
 */
function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (raw === null) return undefined;

  const seconds = Number(raw.trim());
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined;
}
