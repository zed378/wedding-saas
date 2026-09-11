# P1-01 — Password hashing and password policy

| | |
|---|---|
| **Date** | 2026-09-11 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-01 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-01-password-hashing` |
| **Status** | Completed |
| **Spec** | [`MEMORY/specs/P1-01-password-hashing.md`](../specs/P1-01-password-hashing.md) |

---

## What Changed

The first piece of Phase 1. `backend/api/src/modules/auth/password/` can hash a password, verify one, and reject a bad one — with argon2id parameters **measured on the deployment host** rather than copied, and with verification that takes the same time whether or not the account exists.

Nothing calls it yet. `P1-02` (registration) and `P1-03` (login) are the consumers, and it is a task of its own because both are easier to get wrong than to write.

## Why

`docs/SECURITY/03` § Password fixes the algorithm and the policy; § Login Rate Limiting fixes something subtler — the response "does not distinguish an unregistered email from a wrong password". That is a statement about **time**, not just about the message, and it is only true if the code does the same work on both paths. Retrofitting that after `P1-03` exists means changing the shape of the login flow; doing it here means the flow is built on top of a function that is already correct.

## How

**Parameters measured, not copied** (ADR-045). Run on the deployment host from `P0-23` — Ubuntu 24.04, 4 cores, inside `node:24-alpine` — across a grid of memory, time and parallelism. 64 MiB / t=3 / p=1 at **277 ms** median. Over three times OWASP's floor on memory, which is the dimension that makes argon2 expensive to attack on a GPU.

`p=1` although `p=2` is faster (162 ms): parallelism spends *cores per hash*, and this host has four shared with eight other compose projects. One core per login is predictable.

**A missing hash still costs a hash.** `users.password_hash` is nullable — a Google account has no password — and `P1-03` will call this for emails that may not exist. `verifyPassword` verifies against a lazily-computed dummy hash built from the *current* parameters, so its cost tracks the real one automatically. A hard-coded dummy would drift silently the day the parameters changed.

**The signature is the control.** `verifyPassword(hash: string | null | undefined, plain)` — the call site cannot forget that an OAuth-only account has no password, because the type makes it pass the null through.

**The breach check fails open, loudly** (ADR-044). `checkBreached` reports `unavailable` as a value distinct from `safe`, and the policy emits `auth.breach_check_unavailable` at `warn` when it fires. Folding the two together would have made the fail-open decision unobservable by construction.

**Only the SHA-1 prefix leaves the process.** That is what k-anonymity means, and there is a test asserting the URL contains neither the password nor the suffix — it is one careless template literal away from being untrue.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/auth/password/password.params.ts` | **New** — the parameters and the measurement table |
| `backend/api/src/modules/auth/password/password.service.ts` | **New** — `hashPassword`, `verifyPassword`, `needsRehash` |
| `backend/api/src/modules/auth/password/breach-check.ts` | **New** — HIBP k-anonymity, injected fetch |
| `backend/api/src/modules/auth/password/password-policy.ts` | **New** — the four rules |
| `backend/api/src/modules/auth/password/index.ts` | **New** — the barrel; going through it is what keeps `verifyPassword` the only comparison |
| `backend/api/test/password.spec.ts` | **New** — 37 tests |
| `packages/logging/src/logger.ts` | `auth.breach_check_unavailable` added to the closed event set |
| `pnpm-workspace.yaml` | `argon2: false` — build denied, with the verification recorded |
| `backend/api/package.json` | `argon2@^0.45.1` |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| argon2id, 64 MiB, t=3, p=1 | Measured on the deployment host; memory is the dimension worth buying | ADR-045 |
| The breach check fails open and emits an event | The specification calls it *recommended*; failing closed blocks registration during someone else's outage | ADR-044 |
| `unavailable` is distinct from `safe` | Otherwise the caller cannot tell a clean result from a control that is off | ADR-044 |
| A fourth rule: the password may not resemble the user's name or email | The commonest weak password, and no breach list contains it because it is unique to that person | — |
| Passwords are never trimmed | A trimmed password works at registration and fails at login | — |
| Length counted in code points | Eight emoji are eight characters to a user and sixteen to `String.length` | — |
| argon2's install script denied | A prebuilt binding exists — verified on the dev machine **and on Alpine** | — |

## Deviations from `docs/`

None. One addition beyond the document (the identity-resemblance rule) and one decision it left open (the failure mode, ADR-044).

## Tests Added

37, all unit. API unit total 96 → 133. No integration test: nothing here touches a database, and the HIBP client is injected so nothing reaches the network.

| Group | Cases |
|---|---|
| Hashing | the encoded hash carries **exactly** the configured parameters; salted; **fits `varchar(255)`**; never contains the plaintext |
| Verification | right/wrong; a one-character difference; **`null`, `undefined` and empty**; corrupt, truncated and bcrypt-shaped hashes return `false` rather than throwing |
| **Timing** | wrong-password and unknown-user medians within a 1.5× ratio, interleaved over six rounds; and a direct assertion that the null path takes more than 10 ms |
| `needsRehash` | current parameters, weaker parameters, unparseable |
| Policy | below/at the minimum; a 64-character passphrase accepted; over the cap rejected; **code points not UTF-16 units**; spaces preserved; name and email local part rejected; an unrelated password accepted; a 2-letter name does not match everything; every violation reported at once; the password never appears in a message |
| Breach check | **only the prefix is sent**; breached with count; safe; padding entries ignored; `Add-Padding` requested; network failure, 503 and an HTML body all report `unavailable` |
| Failure mode | fails **open** when unreachable; rejects when the API answers; the count is not in the message; **no call at all** for a password that already failed another rule |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| Passwords stored as argon2id with the chosen parameters | `docs/SECURITY/03` § Password | "produces an argon2id hash carrying the configured parameters" — asserts the encoded prefix, so a parameter change cannot pass unnoticed |
| Response time does not reveal whether an account exists | `docs/SECURITY/03` § Login Rate Limiting | "does comparable work for an unknown user as for a wrong password". **Mutation**: removing the dummy-hash verification fails it and its companion; removing the `null` guard entirely fails the same two |
| An OAuth-only account cannot be logged into with a password | `docs/SECURITY/03` § Google OAuth | "a null hash never verifies" — `null`, `undefined` and `""` |
| A corrupt hash is not an authentication bypass | — | "returns false rather than throwing on a corrupt hash", three shapes including a bcrypt string |
| The password never reaches a third party | `docs/SECURITY/03` | "sends only the SHA-1 prefix, never the password" — asserts the URL contains neither the password nor the SHA-1 suffix |
| The response size does not identify the bucket | — | "requests padding, so the response size reveals nothing" — asserts the `Add-Padding` header |
| No plaintext password is written to a log or a column | `docs/DATABASE/02` Notes, `docs/DEVOPS/06` | `password` is in `REDACTED_KEY_NAMES` (`P0-12`, tested in `@wi/logging`). Nothing here passes a password to a logger at all, and "never puts the password in a message" asserts it is absent from every violation message |
| A weak password is rejected | `docs/SECURITY/03` § Password | Eleven policy tests, including the breached case against a mocked HIBP |
| A failed breach check is visible | `P1-01` step 4, ADR-044 | `logSecurityEvent("auth.breach_check_unavailable", …)`, and the event name was added to the closed set in `@wi/logging` rather than passed as free text |

## Abuse Cases Covered

Every row of the spec's § 11 table has a test, listed above. The two that carry the most weight: timing-based user enumeration, and logging into a Google-only account with a password.

## DoD Verification

- [x] **No plaintext password is ever written to a log or a database column.** This task writes no column; the redactor covers the log path and a test asserts the plaintext is absent from every message it produces.
- [x] **Parameters are recorded in an ADR with the measurement that produced them.** ADR-045, with the full grid.
- [x] **The breached-password failure mode is decided, recorded, and observable.** ADR-044; `auth.breach_check_unavailable`.
- [x] **The timing-equality test passes** — and, more usefully, fails under two separate mutations.
- [x] Feature spec written **before** the code (`Spec required: Yes`).
- [x] `bash scripts/verify.sh` clean.

## What Did Not Work

**1. A mutation disproved a claim I had written in the spec.**

The spec's § 12 predicted that removing the `null` guard from `verifyPassword` would fail "a null hash never verifies". **It does not.** With the guard gone, `argon2.verify(null, …)` throws, the `catch` returns `false`, and the test passes — the correct answer, arriving far too quickly.

What actually catches it is the pair of **timing** tests. So the `null` guard is a timing control, not a correctness one, and the correctness test protects nothing about it. Both the spec and the test file now say so, because the next person to simplify that branch will do it on the grounds that the behaviour looks unchanged — and they will be right about the behaviour.

This is the third time in this project a test has turned out to verify less than its name suggested (`P0-12`'s generated redaction payload, `P0-19.1`'s formatter copy). The only thing that found it was running the mutation instead of asserting it would work.

**2. `argon2`'s install script needed a decision, and the answer was not obvious.**

`pnpm-workspace.yaml` denies install scripts by default and requires each package to be decided individually. argon2 works without its postinstall because it ships prebuilt bindings — but *this machine is Windows and the deployment target is Alpine*, and musl prebuilds are frequently missing where glibc ones are present. Verified on both before denying it. A binding that loads on a laptop and not in the container is a `P0-19`-shaped failure, found at deploy time.

**3. `vi.fn()` infers a zero-argument signature.**

`fetchMock.mock.calls[0]![0]` is a type error against a tuple of length 0, so the tests that assert *what was sent* — the most valuable ones in the breach-check group — did not compile. `vi.fn<typeof fetch>(…)` fixes it. Worth knowing before reaching for `as any`, which would have removed the checking exactly where the assertion matters.

## Follow-Ups and Open Questions

- **`needsRehash` is exported and unused.** Deliberate: `P1-03` is the only place a plaintext password and a stored hash exist together, so it is the only place a rehash can happen. It lives here, beside the parameters it compares against, so it is not reimplemented from memory there. `P1-03` must call it.
- **Nothing alerts on `auth.breach_check_unavailable`.** ADR-044's compensating control is a log line, and `docs/DEVOPS/07` § Alerting has no rule for it. A warn-level line nobody watches is the silent failure the ADR exists to avoid, one step removed. `P6`.
- **The parameters are a property of one host.** If production differs, re-measure. ADR-045 says so as a condition rather than leaving it implicit.
- **No rate limiting yet.** `P1-07`. Until then the only thing bounding an attacker's hash rate is the 277 ms itself.

## What to Watch

**The timing test is the only thing holding the `null` guard in place**, and it is a *statistical* test on a shared machine. If it ever becomes flaky, the tempting fix is to widen the tolerance until it stops failing — at which point it stops detecting anything. The companion test ("would fail if the null path short-circuited") is the cheap, non-statistical backstop and should survive any such tidying.

**The identity-resemblance rule needs a name and email to do anything.** `checkPasswordPolicy` takes them as optional context, so a call site that forgets to pass them silently disables that rule. `P1-02` and `P1-05` both must pass it.

**The breach check adds a third-party dependency to the registration path.** It is bounded at 2 s and fails open, but a slow HIBP still makes registration feel slow for every user, and the timeout is the only thing between that and a hang.
