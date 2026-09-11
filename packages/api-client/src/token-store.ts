/**
 * P0-22 — the access token store.
 *
 * `docs/FRONTEND/02` § Auth Token Storage: "Access token: in-memory (JS store), **NEVER
 * in localStorage** (mitigating XSS token theft — see SECURITY/03). Refresh token: an
 * HTTP-only cookie (never accessible to JS at all)."
 *
 * ## The rule is enforced by there being nothing else here
 *
 * The DoD asks that "the API client has no code path that writes an access token to
 * persistent storage". The cheapest way to guarantee that is not a review checklist —
 * it is a module whose only storage is a closure variable. There is no `persist` option
 * to pass `true` to, no `storage` parameter defaulting to `sessionStorage`, and nothing
 * to configure wrongly at three in the morning.
 *
 * `scripts/check-token-storage.mjs` holds the other half: no file outside this one may
 * name `localStorage` or `sessionStorage` beside a token at all.
 *
 * ## What "in memory" costs, and why it is still right
 *
 * A page reload loses the access token. The user is not logged out — the refresh token
 * is an HTTP-only cookie the browser still holds, so the client silently exchanges it
 * for a new access token on the first request. That is one extra round trip on a cold
 * load, in exchange for a token an injected script cannot read.
 */

export interface TokenStore {
  /** The current access token, or `undefined` when there is none. */
  readonly get: () => string | undefined;
  readonly set: (token: string) => void;
  readonly clear: () => void;
  /** Fires whenever the token changes, so a store can react to a logout. */
  readonly subscribe: (
    listener: (token: string | undefined) => void,
  ) => () => void;
}

export function createTokenStore(): TokenStore {
  // The entire storage. Not a field on an exported object -- a closure variable, so
  // nothing outside this module can reach past `get`/`set`/`clear` to serialise it.
  let token: string | undefined;
  const listeners = new Set<(token: string | undefined) => void>();

  const notify = (): void => {
    for (const listener of listeners) listener(token);
  };

  return {
    get: () => token,

    set: (next) => {
      token = next;
      notify();
    },

    clear: () => {
      token = undefined;
      notify();
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The process-wide store.
 *
 * One per browser tab, which is what "in memory" means in practice. Exported as a
 * singleton because two stores would mean two answers to "am I logged in", and the
 * losing one produces a 401 the user cannot explain.
 *
 * On the server (`public-invite`'s SSR pass) this module is loaded per request in
 * Next.js's server runtime and holds nothing — the public invitation is unauthenticated
 * by design (`docs/API/08`), so there is no token to leak between requests. A future
 * authenticated server render must pass a request-scoped store rather than using this
 * one; that is why `createTokenStore` is exported at all.
 */
export const accessTokenStore: TokenStore = createTokenStore();
