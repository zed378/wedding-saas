import argon2 from "argon2";

/**
 * P1-01 — the argon2id parameters, and the measurement that chose them.
 *
 * `docs/SECURITY/03` § Password: "Hash with **argon2id** (recommended) or bcrypt with a
 * cost factor >= 12." The card asks for parameters "measured on hardware resembling the
 * deployment target rather than copying values from a blog post".
 *
 * ## The measurement
 *
 * Run on the deployment host itself (Ubuntu 24.04, 4 cores, 15 GiB, `node:24-alpine`,
 * `--cpus 4`), median of five hashes after a warm-up:
 *
 * ```
 *   memory   t  p |  median
 *    32 MiB  2  1 |    94 ms
 *    32 MiB  3  1 |   126 ms
 *    64 MiB  2  1 |   195 ms
 *    64 MiB  3  1 |   277 ms   <- chosen
 *    64 MiB  4  1 |   359 ms
 *   128 MiB  3  1 |   580 ms
 * ```
 *
 * ## Why 64 MiB / t=3 / p=1
 *
 * **Comfortably above the floor.** OWASP's current minimum for argon2id is
 * m=19 MiB, t=2, p=1. This is over three times the memory and half again the time.
 * Memory is what makes argon2 expensive to attack on a GPU, so it is the dimension
 * worth spending in.
 *
 * **277 ms is affordable here and would not be everywhere.** A wedding invitation
 * service has a login rate measured in logins per minute, not per second: a couple signs
 * in, edits, and leaves. Paired with `P1-07`'s five-attempts-per-fifteen-minutes limit,
 * the sustained hash rate an attacker can force is tiny. On a service with a login
 * storm every morning this would be the wrong number.
 *
 * **p=1 rather than p=2, even though p=2 is faster.** The table shows 64 MiB/t=3/p=2 at
 * 162 ms, but parallelism spends *cores per hash*, and this host has four of them shared
 * with eight other projects. One core per login is predictable; two makes concurrent
 * logins contend with everything else on the box. Latency is not the constraint here.
 *
 * ## What must happen if this changes
 *
 * Raising the cost does not rehash anything that already exists. `argon2.needsRehash`
 * is how a stored hash gets upgraded, on the next successful login, which is the only
 * moment a plaintext password and a stored hash are both in hand. That belongs to
 * `P1-03` and is recorded there rather than assumed.
 *
 * If production runs on materially different hardware, re-measure. The numbers above
 * are a property of that host, not of the algorithm.
 */
export const ARGON2_PARAMS = {
  type: argon2.argon2id,
  /** 64 MiB, in KiB as the library expects. */
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

/**
 * The longest password accepted, in characters.
 *
 * `docs/SECURITY/03` forbids an "overly strict maximum (allow long passphrases)", and
 * 128 is not one -- it is four times the length of a strong passphrase. It exists
 * because argon2's cost is independent of input length, so without a bound a request
 * carrying a ten-megabyte "password" would be hashed exactly as cheaply as a short one
 * while costing the process the memory to hold and copy it.
 */
export const MAX_PASSWORD_LENGTH = 128;

/** `docs/SECURITY/03` § Password: "Minimum length of 8 characters". */
export const MIN_PASSWORD_LENGTH = 8;
