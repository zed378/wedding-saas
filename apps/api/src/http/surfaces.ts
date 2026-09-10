/**
 * The three HTTP surfaces.
 *
 * docs/ARCHITECTURE/01 § Public vs Authenticated Surface separates these at the routing
 * layer rather than by convention, because they differ in authentication, rate limiting
 * and caching. Keeping the prefixes in one place means a later task cannot accidentally
 * mount an authenticated route on the anonymous surface.
 */
export const SURFACE = {
  /** Authenticated: owners and admins. Bearer token, per-user rate limits. */
  AUTHENTICATED: "api/v1",

  /**
   * Anonymous: guests reading an invitation and submitting RSVP or guestbook entries.
   * Served from the invitation host so a guest submission is same-origin with the page
   * they are reading (ADR-024). Rate limited by IP hash, aggressively cached.
   */
  PUBLIC: "public",

  /**
   * Provider-to-server. No user session exists here: the caller is authenticated by a
   * signature over the raw body (docs/SECURITY/07). Deliberately exempt from the public
   * rate limit -- a provider retry storm is legitimate traffic (docs/SECURITY/02).
   */
  WEBHOOK: "api/webhooks",
} as const;

export type Surface = (typeof SURFACE)[keyof typeof SURFACE];
