/**
 * P1-07 — the rate limit table from `docs/SECURITY/10` § Rate Limiting.
 *
 * Transcribed row for row. The document is explicit that these are "an initial baseline —
 * to be adjusted based on real traffic data post-launch, and are configurable (not
 * hard-coded) for easy tuning", so these are **defaults**, not constants: see
 * `config.ts` for the two override layers above them.
 *
 * ## What `onFailureOnly` means, and why login has it
 *
 * `docs/SECURITY/10` says `POST /auth/login` is "5 **failed** attempts / 15 minutes".
 * That word changes the design: a limiter that counted every request would lock out a
 * household sharing an address after five normal sign-ins, and would let an attacker
 * exhaust a victim's budget by succeeding. So these policies are checked before the
 * attempt and recorded only when it fails — which means the *service* records, not the
 * guard, because only the service knows the outcome.
 */

/** How a request is keyed. Verbatim from the document's `Key` column. */
export type RateLimitKeyKind =
  /** The client IP. */
  | "ip"
  /** The authenticated user id. Requires `requireAuth()` to have run first. */
  | "user"
  /** An email from the request body, plus the IP. */
  | "email+ip"
  /** A hashed IP plus the invitation slug, for public guest actions. */
  | "iphash+slug";

export interface RateLimitPolicy {
  /** The name used in Redis keys, metrics, and the `rl:config` override hash. */
  readonly name: string;
  /** Requests permitted per window. */
  readonly limit: number;
  /** The sliding window, in seconds. */
  readonly windowSeconds: number;
  readonly key: RateLimitKeyKind;
  /**
   * Only failures count against the budget.
   *
   * The guard still CHECKS these; it does not consume. The service calls `recordFailure`
   * when the attempt fails, because the guard runs before the attempt and cannot know.
   */
  readonly onFailureOnly?: boolean;
  /**
   * Refuse the request when Redis cannot be reached, instead of allowing it.
   *
   * ADR-050. True for the credential endpoints: unlimited credential attempts against a
   * live database is a credential-stuffing window, and a login outage is merely an
   * outage. False everywhere else, where refusing every request because the *limiter* is
   * down converts a degraded dependency into a total one.
   */
  readonly failClosed?: boolean;
}

/**
 * `docs/SECURITY/10` § Rate Limiting, in order.
 *
 * `reset-password` is not in the document's table. It is added here at
 * forgot-password's numbers because it accepts a token and a new password, which makes it
 * a credential endpoint by any reading, and leaving it unlimited would make the table's
 * protection of `forgot-password` pointless — the link it sends is what this endpoint
 * consumes. Recorded as a deliberate addition rather than a transcription.
 */
export const DEFAULT_POLICIES: readonly RateLimitPolicy[] = [
  {
    name: "login",
    limit: 5,
    windowSeconds: 15 * 60,
    key: "email+ip",
    onFailureOnly: true,
    failClosed: true,
  },
  {
    name: "register",
    limit: 5,
    windowSeconds: 60 * 60,
    key: "ip",
    failClosed: true,
  },
  {
    name: "forgot-password",
    limit: 3,
    windowSeconds: 60 * 60,
    key: "email+ip",
    failClosed: true,
  },
  {
    // Not in the document's table -- see the note above.
    name: "reset-password",
    limit: 3,
    windowSeconds: 60 * 60,
    key: "ip",
    failClosed: true,
  },
  { name: "rsvp", limit: 10, windowSeconds: 60 * 60, key: "iphash+slug" },
  { name: "guestbook", limit: 10, windowSeconds: 60 * 60, key: "iphash+slug" },
  {
    name: "invitation-create",
    limit: 10,
    windowSeconds: 24 * 60 * 60,
    key: "user",
  },
  { name: "media-upload", limit: 60, windowSeconds: 60 * 60, key: "user" },
  { name: "general-authenticated", limit: 300, windowSeconds: 60, key: "user" },
  { name: "general-public", limit: 100, windowSeconds: 60, key: "ip" },
] as const;

/**
 * Paths that are never rate limited.
 *
 * `docs/SECURITY/02` boundary 5 and the card's step 4: a payment provider retrying a
 * webhook is legitimate traffic, and throttling it into failure loses a payment
 * notification — which `docs/SECURITY/07` makes the only source of truth for payment
 * status. Matched by prefix.
 *
 * Health checks are here for a duller reason: an orchestrator probing every few seconds
 * from one address would otherwise consume the public budget and take the service out by
 * declaring it unhealthy.
 */
export const EXEMPT_PATH_PREFIXES: readonly string[] = [
  "/api/v1/webhooks/",
  "/health",
  "/healthz",
  "/readyz",
] as const;

export function isExemptPath(path: string): boolean {
  return EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Escalating blocks. `docs/SECURITY/10` § Monitoring & Auto-block. */
export const BLOCK_BASE_SECONDS = 15 * 60;
/** A day. Beyond this it is an admin decision, not an automatic one. */
export const BLOCK_MAX_SECONDS = 24 * 60 * 60;
/** How long a strike is remembered, so an occasional offender is not treated as a repeat one. */
export const STRIKE_TTL_SECONDS = 24 * 60 * 60;

/** `min(2^(n-1) x 15 min, 24 h)` for the n-th block. */
export function blockDurationSeconds(strike: number): number {
  const doubled = BLOCK_BASE_SECONDS * 2 ** Math.max(0, strike - 1);
  return Math.min(doubled, BLOCK_MAX_SECONDS);
}
