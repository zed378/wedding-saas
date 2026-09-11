/**
 * `@wi/api-client` — the typed client for the backend API.
 *
 * Built by `P0-22`. Two things live here that must not live anywhere else:
 *
 *   1. **The access token**, in memory only (`docs/FRONTEND/02` § Auth Token Storage).
 *      There is no persistent branch to configure wrongly.
 *   2. **The interceptor** (`docs/FRONTEND/08` § Global Fetch Error Handling): 401
 *      refreshes once and replays, 5xx reports a generic problem, a failed connection
 *      reports offline. Centralised, because every screen handling its own 401 would
 *      handle it slightly differently and the one that got it wrong would log the user
 *      out on a transient failure.
 */

export { ApiClient } from "./client.js";
export type {
  ApiClientConfig,
  ApiResult,
  PaginationMeta,
  RequestOptions,
  TransportProblem,
} from "./client.js";

export {
  ApiError,
  NetworkError,
  UnauthenticatedError,
  type ApiErrorDetail,
} from "./errors.js";

export {
  accessTokenStore,
  createTokenStore,
  type TokenStore,
} from "./token-store.js";
