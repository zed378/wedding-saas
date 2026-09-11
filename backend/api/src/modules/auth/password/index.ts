/**
 * P1-01 — password hashing, verification and policy.
 *
 * `P1-02` (registration) and `P1-03` (login) are the consumers. Nothing else should
 * import the pieces directly: going through this barrel is what keeps `verifyPassword`
 * the only comparison in the codebase.
 */
export {
  hashPassword,
  verifyPassword,
  needsRehash,
  resetDummyHashForTests,
} from "./password.service";

export {
  checkPasswordPolicy,
  type PolicyViolation,
  type PolicyContext,
  type PolicyOptions,
} from "./password-policy";

export {
  checkBreached,
  sha1Parts,
  type BreachResult,
  type BreachCheckOptions,
} from "./breach-check";

export {
  ARGON2_PARAMS,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from "./password.params";
