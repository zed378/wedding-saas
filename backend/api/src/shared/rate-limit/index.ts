/**
 * P1-07 — rate limiting. `docs/SECURITY/10` § Rate Limiting.
 *
 * The policies are `docs/SECURITY/10`'s table, transcribed into `policies.ts` as
 * defaults and overridable at runtime without a deploy (`config.ts`). The Redis-down
 * behaviour is ADR-050: fail closed for credential endpoints, fail open for everything
 * else.
 */
export {
  rateLimit,
  RATE_LIMITER,
  POLICY_REGISTRY,
  deriveKey,
} from "./rate-limit.guard";
export {
  RateLimiter,
  RateLimiterUnavailableError,
  RATE_LIMIT_REDIS,
  type RateLimitDecision,
} from "./rate-limiter";
export { PolicyRegistry, parseEnvOverrides, CONFIG_HASH_KEY } from "./config";
export {
  DEFAULT_POLICIES,
  EXEMPT_PATH_PREFIXES,
  isExemptPath,
  blockDurationSeconds,
  BLOCK_BASE_SECONDS,
  BLOCK_MAX_SECONDS,
  type RateLimitPolicy,
  type RateLimitKeyKind,
} from "./policies";
export { RateLimitModule } from "./rate-limit.module";
