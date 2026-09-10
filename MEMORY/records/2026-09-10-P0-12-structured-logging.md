# P0-12 — Structured logging with redaction and request correlation

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-12 |
| **Phase** | Phase 0 |
| **Surface** | backend, worker |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-12-structured-logging` |
| **Status** | Completed |

---

## What Changed

JSON logs in the documented shape, a `request_id` that reaches anywhere in a request without being threaded through, redaction enforced inside the logger, a separately-tagged security stream, and the envelope that will carry correlation across the queue when `P0-15` builds one. 34 new tests.

## Why

`docs/DEVOPS/06` § Mandatory Redaction says this must happen "at the logger middleware level, **not relying on manual developer discipline each time**". That parenthetical is the whole task. A rule people have to remember holds until the first 2am incident, when someone logs the entire request object to work out what is happening — which is exactly when the log is most likely to be read by the most people and kept the longest.

## How

**Redaction is a walk keyed on field name, not a list of paths.** Pino's built-in `redact` takes paths like `req.body.password`: every new shape needs an entry, and a nested or renamed field slips through silently. `redact()` walks the object and decides by key name, normalised so `access_token`, `accessToken`, `Access-Token` and `ACCESSTOKEN` are one key.

The trade is false positives — a field innocently called `token` gets `[REDACTED]` whether or not it holds anything. That is the right direction to be wrong in.

**It also scrubs values whose key is innocent.** `{ note: "tried Authorization: Bearer eyJhb..." }` is exactly how a token reaches a log: pasted into a message while debugging, under a key nobody would think to guard. Bearer/Basic patterns and JWTs are removed from any string.

**Secrets are removed; account numbers and emails are masked.** For a token even a suffix narrows a brute force and answers no debugging question, so it goes entirely. `account_number` keeps its last four digits, because that is what support needs to confirm they are looking at the right account — and `docs/DEVOPS/06` asks for exactly that. Emails become `a***e@example.com`: enough to correlate two lines, not enough to harvest.

**`request_id` is ambient, via `AsyncLocalStorage`.** The alternative is passing a logger into every service, repository and helper, which works until one function forgets — and the line with no id is invariably the one needed during an incident.

**The redactor is bounded and cycle-safe.** Depth 8, arrays capped at 100, circular references marked. A request object referencing its own socket is normal; an unguarded walk recurses forever. Logging must never be the thing that takes the service down.

**Security events are separated by a field, not a second file.** `docs/DEVOPS/06` § Log Retention wants 1 year for security events against 90 days for application logs, "kept separate". Both streams go to stdout and the aggregator routes on `log_type = "security"`. A second file would need its own rotation, shipping and disk budget to solve a problem the aggregator already solves — and a security log that fills a disk stops being written. `P0-23` configures the retention itself.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/shared/logging/redact.ts` | The redactor — pure, independently testable |
| `backend/api/src/shared/logging/logger.ts` | Pino config, documented field names, security stream |
| `backend/api/src/shared/logging/request-context.ts` | `AsyncLocalStorage` |
| `backend/api/src/shared/logging/job-context.ts` | The queue-crossing envelope |
| `backend/api/src/shared/logging/logging.module.ts` | Global module |
| `backend/api/src/http/request-id.middleware.ts` | Establishes the context; logs one line per request on `finish` |
| `backend/api/src/app.module.ts` | Wired; the middleware-order comment updated |
| `backend/api/test/logging.spec.ts` | 34 tests |
| `.env.example` | `SERVICE_NAME`, `LOG_LEVEL`, `LOG_PRETTY`, with the reason they bypass config |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Key-name walk rather than pino path redaction | A path list needs an entry per shape and misses nesting | — |
| Secrets removed, account numbers masked | A partial token has no debugging value; a partial account number does | — |
| `AsyncLocalStorage` for `request_id` | Threading a logger through every constructor fails the moment one is missed | — |
| Security events tagged, not written to a separate file | The aggregator routes on the field; a second file adds rotation and disk risk | — |
| One request log line, on `finish` | Two half-lines per request is twice the volume and worse to read | — |
| Query string dropped from the logged path | Untrusted input, and people paste tokens into links | — |
| The logger reads `process.env` directly | It must exist before the DI container, to log the container failing to start | — |

## Deviations from `docs/`

None from `docs/DEVOPS/06`.

**One deliberate inconsistency with this repository's own convention**, stated rather than hidden: `config.module.ts` says "nothing in the application reads `process.env` directly — a value read straight from the environment is a value nobody validated". The logger does, for three variables. It has to exist before the Nest container is constructed, because the most important line it will ever write is a failure during construction — a bad `DATABASE_URL`, a missing signing key. A logger that depends on the config module cannot report the config module refusing to start.

The blast radius is small by design: those three change a label, a level, or the output format. None can leak anything, because **redaction is not configurable**.

## Tests Added

34 in `test/logging.spec.ts`; 63 across the unit suite.

| Group | Cases |
|---|---|
| Key names | every secret key name redacted, generated from the source list; **an independent backstop list**; case/underscore/hyphen variants; **any depth**; inside arrays; non-sensitive fields left intact |
| Masking | account number to last four; short numbers fully masked; every masked and email key name |
| Values | bearer token in an innocent field; JWT anywhere in a string |
| Robustness | circular reference; depth bound; array bound; `Error` stays readable; `Buffer` contents not serialised; null/undefined/primitives/bigint |
| Request context | survives `await`; undefined outside a request; enrichable; no-op outside a request |
| Logger | documented field names; `request_id` present and absent; **redaction through a real log call**; a carelessly logged top-level object |
| Security stream | tagged `log_type: security`; the application logger is not |
| Job trace | id survives a JSON round trip; generated for a scheduler; **malformed envelope still runs the job**; enqueue time recorded |

**Mutation-checked**, and the first one exposed a flaw in my own test design:

| Mutation | Result |
|---|---|
| Removed `"password"` from the secret key set | 3 tests failed |
| Made the walk shallow — top level only | 5 tests failed |

**Also verified against the real production path**, not just the test harness: the compiled `dist/` logger, `NODE_ENV=production`, `LOG_PRETTY=false`, logging an object with a password, an account number, an email, an authorization header and a nested refresh token. The canary string appears nowhere; the account number comes out `******7890`, the email `a***e@example.com`, and the security event carries `log_type: "security"`.

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| Passwords never logged | `docs/DEVOPS/06` | Generated test, backstop test, and end-to-end through compiled output. Mutation-checked |
| Tokens of every kind never logged | `docs/DEVOPS/06` | Same, plus value-level scrubbing of bearer tokens and JWTs |
| Account numbers masked, not printed | `docs/DEVOPS/06` | `******7890`, asserted in the production path |
| `raw_callback_payload` never in a log | `docs/DEVOPS/06` | In the secret key set; covered by the generated test |
| Redaction survives nesting | — | `redacts at any depth`, mutation-checked |
| Logging cannot crash the service | — | Cycle, depth and array bounds each tested |
| Security events separable for retention | `docs/DEVOPS/06` § Log Retention | `log_type` asserted present on one logger and absent on the other |

## Definition of Done Verification

- [x] Every log line is JSON and carries `request_id` where one exists — asserted in both directions
- [x] The redaction test passes for all sensitive key names in `docs/DEVOPS/06`
- [x] A worker job logs the `request_id` of the request that enqueued it — **mechanism proven across a JSON round trip; there is no queue until `P0-15`**
- [x] Security events are separable by a field, so retention can differ

## What Did Not Work

**My main redaction test could not have caught a key being deleted.** It builds its payload from `REDACTED_KEY_NAMES` — the redactor's own exported list — so removing `"password"` from the set removes it from both the source and the test, and the test still passes. The mutation check is what exposed this; two *incidental* hardcoded tests happened to fail, which is luck rather than design.

Fixed by adding an independent backstop: an explicit list of the nine key names that must never be dropped, taken from `docs/DEVOPS/06` rather than from the source. Re-running the same mutation now fails a test whose name says exactly what happened.

The general lesson is worth keeping: **a test generated from the code it tests can only verify consistency, never correctness.** It is still worth having — it catches a key added without a rule — but it needs a hand-written companion anchored to the specification.

**`exactOptionalPropertyTypes` rejected `transport: undefined`.** Passing an explicit undefined is not the same as omitting the key under that flag, and pino treats them differently too. Replaced with a spread-or-nothing helper.

**Dynamic `await import()` in tests does not typecheck under NodeNext** without a `.js` extension. I had used it to avoid loading the logger module at test-module load, which starts a pino transport worker. The imports turned out to be unnecessary — the modules were already imported statically at the top of the file — so removing them was the fix, and it took three passes because prettier reflowed each one differently between attempts.

**The compiled output could not be smoke-tested with `node src/...`.** These files are CJS (they import without extensions), so Node's type stripping refuses them. Building first and running `dist/` is the right move anyway: it exercises the path production uses.

## Follow-Ups and Open Questions

- **`P0-15` should use `enqueueEnvelope`/`runJobWithTrace`.** The envelope exists and is tested across a JSON round trip, but nothing enqueues anything yet, so the end-to-end claim in the DoD is about the mechanism rather than a real job.
- **`P0-13` will add the error mapper**, which is where an unhandled exception should be logged at `error` with its request id. Currently only completed requests produce a line.
- **`P0-23` owns the retention split.** The `log_type` field makes it possible; nothing enforces 1 year versus 90 days yet.
- **`P1-06` should call `enrichRequestContext({ userId })`** once authentication runs. The function exists and is tested; nothing calls it.
- **No log shipping.** `docs/DEVOPS/06` § Aggregation wants a centralised system. Logs go to stdout, which the container runtime holds and loses on restart.

## What to Watch

**The secret key list will not keep pace with the codebase on its own.** It covers what exists plus what `docs/` names, but a future field called `providerCredential` or `webhookKey` is not in it. The value-level scrubbing catches bearer tokens and JWTs regardless of key, which is the safety net — but it only recognises those two shapes. Adding a key to the set is a one-line change that nobody will think to make.

**`request_id` correlation is only as good as the boundaries that preserve it.** `AsyncLocalStorage` survives `await` and `Promise` chains, but a context is lost across an `EventEmitter` listener registered outside the request, or a `setTimeout` scheduled from module scope. Both patterns will appear eventually, and the symptom is a log line missing its id rather than an error.

**The query string is dropped from the logged path on purpose.** If someone later "fixes" that to aid debugging, every token pasted into a share link starts landing in a log with 90-day retention. The comment says so at the line.
