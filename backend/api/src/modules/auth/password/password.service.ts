import argon2 from "argon2";

import { ARGON2_PARAMS } from "./password.params";

/**
 * P1-01 — hashing and verification.
 *
 * Two properties matter more than the algorithm choice, and both are about what the
 * function does when the answer is "no".
 *
 *   1. **A missing hash still costs a hash.** `users.password_hash` is nullable -- a
 *      Google account has no password (`P0-07`) -- and `P1-03` will call this for an
 *      email that may not exist at all. Returning early in either case makes the
 *      response time say which, and `docs/SECURITY/03` § Login Rate Limiting requires
 *      the opposite: "does not distinguish an unregistered email from a wrong password".
 *
 *   2. **A malformed hash is a failure, not a crash.** A truncated or corrupt column
 *      must return `false`, not throw -- and certainly not succeed.
 */

/**
 * A real argon2id hash of a value nobody knows, used as the comparison target when
 * there is no stored hash to compare against.
 *
 * Computed once, lazily, with the **current parameters**, so its cost tracks the real
 * one automatically. A hard-coded constant would drift the moment `ARGON2_PARAMS`
 * changed, and the drift would be invisible: the timing test would still pass on the
 * day of the change and slowly stop meaning anything.
 *
 * The promise is cached rather than the value, so concurrent first calls share one
 * computation instead of racing to do the same expensive work.
 */
let dummyHash: Promise<string> | undefined;

function getDummyHash(): Promise<string> {
  dummyHash ??= argon2.hash(
    // Not a secret and never compared against anything a user supplies successfully --
    // it is 32 bytes of nothing in particular, and argon2 salts it regardless.
    "an-unguessable-value-that-is-never-a-real-password",
    ARGON2_PARAMS,
  );
  return dummyHash;
}

/** Hash a password for storage. Always argon2id, always freshly salted. */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_PARAMS);
}

/**
 * Verify a password against a stored hash.
 *
 * `hash` is `string | null` deliberately, and that signature is the control: the call
 * site cannot forget that an OAuth-only account has no password, because the type makes
 * it pass the null through and this function answers `false` — after doing the work.
 */
export async function verifyPassword(
  hash: string | null | undefined,
  plain: string,
): Promise<boolean> {
  if (hash === null || hash === undefined || hash.length === 0) {
    // Do the work anyway, then answer no. The result is discarded on purpose: what
    // matters is that the caller waited as long as a real verification would take.
    await argon2.verify(await getDummyHash(), plain).catch(() => false);
    return false;
  }

  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A hash argon2 cannot parse: truncated, corrupt, or written by something else.
    // `false` rather than a throw, because a corrupt column must not become a 500 on
    // the login path -- and must certainly not become an authentication bypass.
    return false;
  }
}

/**
 * Whether a stored hash was produced with weaker parameters than the current ones.
 *
 * Exported unused, which is deliberate. `P1-03` is the only place a plaintext password
 * and a stored hash exist together, so it is the only place a rehash can happen. Having
 * the check here, beside the parameters it compares against, is what stops it being
 * reimplemented from memory there.
 */
export function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, ARGON2_PARAMS);
  } catch {
    // Unparseable means it certainly does not match the current parameters.
    return true;
  }
}

/** Test seam: forget the cached dummy hash so a test can change parameters. */
export function resetDummyHashForTests(): void {
  dummyHash = undefined;
}
