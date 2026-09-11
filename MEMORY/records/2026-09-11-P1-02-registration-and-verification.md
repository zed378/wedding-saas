# P1-02 — Registration and email verification

| | |
|---|---|
| **Date** | 2026-09-11 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-02 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-02-registration` |
| **Status** | Completed |
| **Spec** | [`MEMORY/specs/P1-02-registration-and-verification.md`](../specs/P1-02-registration-and-verification.md) |

---

## What Changed

`POST /auth/register`, `/auth/verify-email` and `/auth/resend-verification`. A user, their notification preferences and a verification token are created in one transaction; the email is enqueued after it commits; the address is verified by a token that can be redeemed exactly once.

Three pieces of infrastructure came with it: the API's **queue producer** (`P0-15` built the worker, not the producer), a **single-use token service**, and `REDIS_URL` — which the environment schema named in a comment but never declared.

## Why

`docs/API/01` § Registration Flow and `docs/SECURITY/03` § Email Verification. The interesting requirement is the DoD's fourth item — a duplicate registration must not reveal that the email exists — because it shapes the whole endpoint rather than adding a check to it.

## How

**The response is uniform, and so is the work behind it.** Both a new and an existing address return `201` with the same body. The password policy runs *before* the existence check and the argon2 hash is computed *before* it too, so both paths cost the same 277 ms. Returning early on a duplicate would have made the response time say what the status code was careful not to.

**The real owner still gets an email** — *"someone tried to register with your address"*. Without it the attacker learns nothing and neither does the one person entitled to know.

**Single use is enforced by the `UPDATE`, not by a read.** `consumeToken` issues one conditional `UPDATE … WHERE used_at IS NULL` and treats rows-affected as the answer. A mail scanner prefetching the link while the user clicks is the realistic concurrent case, and a read-then-write would let both through.

**SHA-256 for tokens, not argon2.** Argon2's cost exists to make guessing expensive, which matters for a human-chosen password. These are 256 bits from `randomBytes` — there is nothing to guess, and adding 277 ms to every click of a verification link would buy nothing.

**Issuing a token revokes the previous one.** Otherwise "resend" leaves a trail of live links in old emails, the oldest valid for its full 24 hours.

**The gate is a function, not a middleware**, exactly as the card asks. A route guard has to be remembered on every new route, and the routes needing it are two out of dozens — so the default must be "no gate", which makes it forgettable precisely where it matters. Calling it from the service also survives `POST /publish` gaining a second caller.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/infra/queue/queue.module.ts` | **New** — the producer; enqueue failure is logged, not propagated |
| `backend/api/src/modules/auth/tokens/single-use-token.service.ts` | **New** — issue and consume |
| `backend/api/src/modules/auth/registration.service.ts` | **New** |
| `backend/api/src/modules/auth/auth.controller.ts` | **New** — `docs/API/01` |
| `backend/api/src/modules/auth/require-verified-email.ts` | **New** — the publish/checkout gate |
| `backend/api/src/config/env.schema.ts` | `REDIS_URL` declared |
| `backend/api/test/integration/registration.itest.ts` | **New** — 22 tests |
| `backend/api/package.json` | `bullmq`, `ioredis` |

## Decisions Made

| Decision | Rationale |
|---|---|
| A duplicate registration returns the same `201` as a new one | `register` is unauthenticated and unlimited; `409` would make it an oracle for "does this person have an account on a wedding service" |
| Hash the password before checking existence | Otherwise the response time distinguishes the two paths as clearly as a status code |
| SHA-256 for single-use tokens | 256 bits of entropy leaves nothing to guess; argon2 would add cost for no gain |
| One conditional `UPDATE` for redemption | Two clicks race in the database rather than in application code |
| Issuing revokes the prior unused token of that type | One live link per purpose |
| Enqueue failure does not fail the request | The notification is asynchronous so the user need not wait; undoing a registration because Redis blinked is worse than a missing email |
| `already_verified` is a success, not an error | The user clicked twice and got what they wanted |

## Deviations from `docs/`

None.

## Tests Added

22 integration. API integration total 191 → 213.

| Group | Cases |
|---|---|
| The transaction | user, preferences and token created together; email lowercased; `password_hash` is argon2id |
| Tokens | only a 64-hex hash is stored, and it equals `hashToken(token)`; 24-hour expiry |
| The job | enqueued after commit and names a user that can be looked up; registration survives a queue that throws |
| **Enumeration** | identical result for new and existing; no second user; the owner is told; **a weak password is rejected identically either way** |
| Verification | verifies; **a used token cannot be redeemed twice**; **two simultaneous redemptions yield exactly one `verified`**; expired refused; unknown refused; **a `password_reset` token is not accepted as a verification token**; the token determines the user |
| Resend | reveals nothing for an unknown address; silent for a verified one; a fresh token works; **the previous token is dead** |
| The gate | verified passes; unverified throws `EMAIL_NOT_VERIFIED` with status 403 |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| Registration does not reveal whether an email exists | `docs/SECURITY/03` | Four tests. **Mutation**: returning a distinct result for a duplicate fails "does not reveal that an email is already registered" |
| A verification token cannot be reused | `docs/SECURITY/03` | **Mutation**: dropping `isNull(usedAt)` from the conditional `UPDATE` fails three tests, including the concurrent one |
| Tokens are stored hashed | `docs/DATABASE/02` | "stores only a hash of the token" — asserts the stored value is 64 hex characters and is not the token |
| Tokens expire in 24 hours | `docs/SECURITY/03` | Asserted against `expires_at - created_at` |
| One user cannot verify another's address | — | Structural: the user comes from the token and there is no id in the request. Asserted by verifying one user and checking the other is untouched |
| Tokens are not interchangeable between purposes | — | A `password_reset` token is rejected by `verifyEmail` |
| Unverified users are refused at publish and checkout | `docs/API/01` step 2 | `requireVerifiedEmail` tested. **The endpoint tests cannot exist yet** — see below |
| No token or password reaches a log | `docs/DEVOPS/06` | `token`, `tokenhash` and `password` are all already in `REDACTED_KEY_NAMES` — checked, not assumed |

## Abuse Cases Covered

Every row of the spec's § 11 table has a test except the last, which needs endpoints that do not exist yet.

## DoD Verification

- [x] Verification tokens are stored hashed, expire in 24 hours, and cannot be reused.
- [x] Registration succeeds when the email path fails — proven with a queue that throws.
- [ ] **An unverified user can draft but is refused at publish and checkout, proven by tests on both.** **Partially met.** The gate exists and is tested; `POST /publish` (`P3-06`) and `POST /orders` (`P3-01`) do not exist, so there is nothing to test against. Recorded as an obligation on both cards rather than claimed here.
- [x] A duplicate registration does not reveal that the email exists.

## What Did Not Work

**1. The spec was wrong about the redactor.** § 13 asserted that `token` was missing from `REDACTED_KEY_NAMES` and had to be added. It was already there, with `tokenhash` — `P0-12` deliberately made the set wider than `docs/DEVOPS/06`'s list. Checked before acting on it; the spec now carries the correction rather than being quietly edited.

**2. `REDIS_URL` was documented but never declared.** The schema's header comment listed it as a `P0-15` variable; the schema itself did not have it, so nothing validated it and the API would have started without it and failed on the first registration instead of at boot. Declaring it broke six config tests that build environments by hand — the right kind of breakage.

**3. A blanket regex added `REDIS_URL` to a fixture that is not an environment.** `checkSecretRules` takes a narrow `Checked` interface, not the full env, so the extra key was a type error. Trimmed to the `loadEnv` call sites only.

## Follow-Ups and Open Questions

- **`P3-01` and `P3-06` must call `requireVerifiedEmail`** and test it. That is the unmet half of DoD item 3.
- **Email delivery is a stub.** `P4-06` owns the provider; the job is enqueued and the worker logs it. The DoD only requires that registration not block on it.
- **Rate limiting is `P1-07`.** Until then `register` is unlimited, which matters more here than elsewhere because each call costs a deliberate 277 ms of argon2 — it is a denial-of-service amplifier until that lands.
- **The queue producer swallows enqueue failures.** Correct for notifications, wrong for anything whose loss matters. `P3`'s payment webhook must not use it — noted in the module's own comment.

## What to Watch

**The uniform registration response is easy to "fix".** A future reviewer will see `201` for a duplicate address and read it as a bug. The four enumeration tests are what stand between that instinct and a regression.

**The pre-hash before the existence check looks like wasted work**, and is the only thing keeping the two paths the same length. It is commented, but it is exactly the sort of thing a profiler-driven change would remove.
