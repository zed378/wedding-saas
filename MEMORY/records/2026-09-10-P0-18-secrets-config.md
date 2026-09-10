# P0-18 — Secrets and configuration conventions

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-18 |
| **Phase** | Phase 0 |
| **Surface** | infra |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-18-secrets-config` |
| **Status** | Completed |

---

## What Changed

Every secret enumerated with a rotation runbook and a blast radius (`deploy/SECRETS.md`), a secret scanner that blocks at commit time, and — the part that matters — the service refusing to start when the configuration mixes environments. 22 tests.

## Why

Two different problems wear the same name.

Keeping secrets **out of the repository** is a process question with a mechanical answer: scan the diff, block the commit.

Keeping them in the **right environment** is not. A live Midtrans key on staging is a valid string, the right shape, the right length. Every per-field check passes it. The only thing that can tell it is catastrophically wrong is a rule looking at two values at once — and "catastrophic" is literal, because a staging test would charge a real card.

## How

**The environment split is enforced by refusing to boot.** `secret-rules.ts` runs after the per-field schema passes and rejects:

- a **live** payment key outside production — a test run would charge real cards;
- a **sandbox** key *inside* production — every payment succeeds against the provider's test environment, no money arrives, and the orders look paid. Nothing errors, so nothing alerts. This is the direction most likely to be questioned, because the configuration "works";
- a signing key under 32 characters in production, a non-HTTPS origin, a localhost database.

The sandbox prefix (`SB-`) is a property of the provider's key format, so the rule recognises a live key rather than trusting a separate mode flag someone would have to remember to flip in step with it.

**All violations are reported at once.** One at a time means a restart per mistake, which is how people end up commenting out validation — the same reasoning `loadEnv` already used.

**Scanning blocks at commit, not at push.** A leaked credential is not recoverable by deleting the commit: once it reaches a shared history it is rotated or it is compromised. The only useful moment is before it lands.

**The scanner never prints the value it found.** A scanner that echoes a secret into a terminal, a CI log and a screenshot has moved the leak rather than stopped it. It prints six characters and a length.

**Scopes are separate stores, not folders.** A single store with a naming convention makes a cross-environment read a typo away, and the typo that matters is reading production credentials into staging.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/config/secret-rules.ts` | The cross-field rules |
| `backend/api/src/config/env.schema.ts` | Nine secrets added; `loadEnv` now applies the rules |
| `backend/api/src/main.ts` | Exits 78 on `SecretRuleError` too |
| `scripts/check-secrets.mjs` | The scanner |
| `.githooks/pre-commit` | New — blocks on a staged credential |
| `scripts/verify.sh`, `package.json` | Whole-tree sweep wired in |
| `deploy/SECRETS.md` | The inventory, rotation and blast radius |
| `MEMORY/DECISIONS.md` | ADR-034 |
| `backend/api/test/secret-rules.spec.ts` | 22 tests |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Per-environment scopes, not one store | A cross-environment read should not be a typo away | ADR-034 |
| Refuse to start on a mixed configuration | Only a machine catches a *correct* secret in the wrong place | ADR-034 |
| Recognise the `SB-` prefix, no mode flag | A flag is a second value that can disagree with the key | ADR-034 |
| Block at commit, not push | A leak in a shared history is already a rotation | ADR-034 |
| Never print the matched value | Otherwise the scanner relocates the leak | — |
| Narrow patterns, documented escape | A scanner that cries wolf gets disabled | — |

## Deviations from `docs/`

None. `docs/DEVOPS/00` describes the intent and this implements it. Step 5 of the card asks for scanning "in CI, and a pre-commit hook" — CI is deferred (ADR-028), so the hook and `scripts/verify.sh` carry it, consistent with every other gate since `P0-17`.

## Tests Added

22 in `test/secret-rules.spec.ts`; 113 across the API's unit suite.

| Group | Cases |
|---|---|
| Payment keys | live key refused in **development, test and staging**; sandbox refused in production; each accepted where it belongs; **the client key is checked too**; absent is fine |
| Production rules | short signing key refused; long accepted; **not applied outside production**; each of three origins must be HTTPS; localhost database refused; **all violations reported at once** |
| End to end | `loadEnv` throws `SecretRuleError` on a live key in development; a valid development environment loads |

**Mutation-checked:**

| Mutation | Result |
|---|---|
| Removed the live-key-outside-production check | 5 tests failed |
| Removed the sandbox-in-production check | 2 tests failed |

The scanner was tested both ways: a whole-tree scan of 377 files passes, and a staged file containing a Midtrans-shaped key is refused by the hook with exit 1.

## Security Verification

| Control | Requirement source | How it was verified |
|---|---|---|
| Staging cannot use live payment credentials | `docs/DEVOPS/00` § Configuration per Environment | Three environments tested, mutation-checked |
| Production cannot use sandbox credentials | `docs/DEVOPS/00` | Tested, mutation-checked |
| Secrets are not committed | `docs/DEVOPS/00` | Blocking pre-commit hook, tested both ways |
| A signing key is long enough to matter | `docs/SECURITY/03` § Tokens | Length rule, production only |
| Session cookies cannot be sent over http | `docs/SECURITY/03` | HTTPS required for all three origins in production |
| `.env.example` holds no real value | task DoD | Whole-tree scan clean |

## What Did Not Work

**The scanner's first real run flagged one of our own tests.** `logging.spec.ts` contains a fake JWT — the fixture proving the `P0-12` redactor scrubs JWTs — and it matched the JWT pattern exactly, because it is shaped like one.

That is the false-positive class the script's own comments predicted, and the fix is the documented escape: a word like `example` on the line. Adding it also makes the fixture read as a placeholder to a human, which it should have anyway. Worth noting that the escape hatch was exercised by accident on day one, which is a reasonable signal that it needed to exist.

**The hook then blocked my own commit — twice.** The record above was written before I tried to commit it, and the sequence is worth keeping in full because it is the only real test the hook has had:

1. `git commit` was **refused**: the test fixtures read `Mid-server-EXAMPLEnotarealkey00`. The placeholder allowance needs a word boundary around `example`, and a run-together word has none. Nothing was lost — the work stayed staged — but the commit did not happen, and the `git branch -d` that followed silently succeeded because the branch still pointed at `main`. Had I not checked the repository state, I would have reported a merge that never occurred.
2. Fixed by putting hyphens in the fixtures. Refused **again** — this time flagging the comment I had just written *explaining the first refusal*, because it quoted the old key-shaped string verbatim.

Both refusals were correct. The fix each time was the fixture and the prose, not the scanner: a placeholder should read as one to a human as well as to a regex, and a comment about a credential should not spell out a credential-shaped string.

The useful conclusion is not "the scanner works". It is that **the false-positive path is the one that gets exercised**, so the escape hatch has to be documented in the error message itself — which it is, and which is how I knew what to do both times without reading the source.

**The database-URL pattern needed an exclusion list.** `postgres://wedding_app:wedding_app_dev@…` is a committed local-development credential (`P0-05`, deliberately, and labelled as such). Without a negative lookahead for the known placeholders, the scanner would have failed on `docker-compose.yml` and `.env.example` — the two files it must tolerate, since those values existing is the whole point of a one-command local stack.

## Follow-Ups and Open Questions

- **No secret manager is actually configured.** ADR-034 records the decision; `P0-23` provisions it. Until then staging and production do not exist, so nothing is stored anywhere.
- **`STORAGE_*` and the payment keys are optional.** Right for tests, wrong for production — `P0-23` must make them required outside development, or the in-memory storage fallback becomes silent data loss.
- **Rotation is documented, not automated.** `deploy/SECRETS.md` gives the procedure and the blast radius for each. Nothing schedules or reminds.
- **`JWT_SIGNING_KEY` rotation needs a dual-key window** to avoid signing every user out. `P1-03` should build the verification path to accept two keys rather than one, or the runbook's advice cannot be followed.
- **`--no-verify` bypasses the hook**, and with CI deferred nothing else checks. `deploy/SECRETS.md` says to treat a value as compromised if it is used.

## What to Watch

**The sandbox-in-production rule will be hit during the first production deploy**, by someone copying staging's configuration as a starting point. That is exactly when it should fire and exactly when it will be most tempting to remove — the deploy is blocked, the key "works", and the check looks like pedantry. It is not: a sandbox key in production means every order shows as paid and no money ever arrives.

**The scanner's patterns will drift behind the providers.** They match the shapes that exist today. A new provider, or a format change, is invisible to it — and the failure mode is silence, not an error. Any new integration should add its key shape here in the same change.

**`deploy/SECRETS.md`'s blast-radius column is the part that rots.** The rotation steps are stable; what breaks during a rotation changes as the system grows. `REFRESH_TOKEN_PEPPER` currently ends every session — once there are more session-bearing surfaces, it will end more than that, and nothing will update the table automatically.
