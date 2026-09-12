# P1-04 — Google OAuth

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-04 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-04-google-oauth` |
| **Status** | Completed |
| **Spec** | [`MEMORY/specs/P1-04-google-oauth.md`](../specs/P1-04-google-oauth.md) |

---

## What Changed

`POST /auth/oauth/google`. An `id_token` is verified against Google's keys, and the
identity that results — subject id, email, whether Google has verified it — comes from the
signed payload and from nowhere else. A new identity registers; a returning one matches on
subject id; an existing password account links, but only when Google has verified the
address.

`idx_users_oauth` became a **unique** partial index (ADR-049, migration `0005`), which
answers `OQ-15`.

## Why

`docs/API/01` § Google OAuth and `docs/SECURITY/03` § Google OAuth, whose whole content is
one instruction: *"The `id_token` is verified directly with Google (server-side); NEVER
trust the email from the request body."*

## How

**The request body has one field, so there is no email to trust.** `docs/SECURITY/03`'s
rule is normally implemented as discipline — remember not to read `body.email`. Here the
Zod schema is `{ id_token }` and Zod strips unknown keys, so an `email` sent alongside does
not survive parsing and never reaches the service. `GoogleOAuthService.authenticate` takes
a single opaque string; the attack cannot be expressed in the call signature.

**The audience is checked, because that is the one people skip.** A token minted for a
*different* Google application is validly signed by Google and carries a real, verified
email. Without `audience`, any site using Google Sign-In could hand us its users' tokens
and get sessions here.

**An unverified Google email is refused for linking *and* for registration.** A Workspace
administrator can create an identity on any address in a domain they control, and Google
reports `email_verified: false` for those. Accepting one for linking is account takeover
without a password; accepting one for registration creates an account whose password-reset
path belongs to somebody else.

**"Bad token" and "Google is down" are different answers.** The library throws the same
`Error` for both. A `401` for an unreachable JWKS endpoint would send a user to a password
form for an account that may have no password, and turn somebody else's outage into their
mistake. Unrecognised failures classify as *unavailable*, so the fragile part fails safe.

**Matching order is the card's step 3**: subject id first, then verified email. The subject
id is stable for the life of a Google account and survives the user changing their address.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/auth/oauth/google-verifier.ts` | **New** — verification and failure classification |
| `backend/api/src/modules/auth/oauth/google-oauth.service.ts` | **New** — match, link, register |
| `backend/api/src/modules/auth/auth.controller.ts` | `POST /auth/oauth/google` |
| `backend/api/src/modules/auth/auth.module.ts` | Verifier provided by factory, so tests can replace it |
| `backend/api/src/http/errors.ts` | **`ServiceUnavailableError`** (503) |
| `backend/api/src/config/env.schema.ts` | `GOOGLE_OAUTH_CLIENT_ID`, optional |
| `backend/api/src/infra/db/schema/users.ts` | `idx_users_oauth` now unique and partial |
| `backend/api/migrations/0005_unique_google_identity.{sql,down.sql}` | **New** |
| `docs/DATABASE/02-USERS.md` | The index updated to match, per the deviation protocol |
| `backend/api/test/google-verifier.spec.ts` | **New** — 26 tests |
| `backend/api/test/integration/google-oauth.itest.ts` | **New** — 27 tests |
| `backend/api/test/auth-http.spec.ts` | 5 tests for the new endpoint |
| `backend/api/test/support/rejection.ts` | **New** — shared test helper, see below |
| `backend/api/package.json` | `google-auth-library` |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| A Google identity is unique across active accounts | Step 3 makes the subject id a login key; a duplicate makes login ambiguous | ADR-049 (answers `OQ-15`) |
| Unverified Google email refused for registration too, not only linking | An account on an unproven address has a password-reset path belonging to someone else | — |
| Google unreachable is `503`, not `401` | The user did nothing wrong, and may have no password to fall back on | — |
| An unrecognised library error classifies as *unavailable* | The classification is message-based and therefore fragile; it fails toward refusing service rather than toward accepting something | — |
| `GOOGLE_OAUTH_CLIENT_ID` optional, checked at use | Requiring it would stop every developer not working on OAuth from booting the API | — |
| The verifier never forwards the library's message | Several of those messages embed the `id_token` itself — see *What Did Not Work* | — |

## Deviations from `docs/`

**One.** `docs/DATABASE/02` writes `idx_users_oauth` as a plain index. It is now `UNIQUE`
and partial over active rows. **The document was updated in this task**, as
`TASKS/00-TASK-CONVENTIONS.md`'s deviation protocol requires, and the reasoning is in
ADR-049.

## Tests Added

58 (31 unit, 27 integration). API unit total 173 → 204; integration 249 → 276.

| Group | Cases |
|---|---|
| Audience | **the client id is passed as the audience**; a wrong-audience rejection is a 401 |
| Rejections | six library messages — bad signature, expired, too early, unknown key, malformed, wrong issuer |
| **No credential leaves the library** | the `id_token` appears in neither `message` nor `reason`; an email in a payload-embedding message does not either |
| Unavailability | DNS, timeout, a 500, **and a wording nobody predicted**; a missing client id names the variable |
| The identity | email lowercased; **four non-`true` values of `email_verified` all read as unverified**; empty name is `undefined`; four malformed payloads refused |
| New identity | registers; verified immediately; **no password hash**; provider and subject recorded; preferences created; name falls back to the local part; truncated to 100 |
| Returning identity | **matches on subject id even when the email changed**; no second account; **one identity cannot attach to two accounts** (asserted at the database, `23505` on `idx_users_oauth`); a soft-deleted account frees its identity |
| Linking | links when verified; **the password survives, so both methods work**; **an unverified Google email cannot claim an existing account**; nor register; a linked identity still matches later |
| **Body influence** | the body email has no influence on the identity: the victim's row is untouched and a separate account is created for what Google actually said |
| Suspension | refused; no session issued |
| Session shape | a three-part access token and a rotating refresh token, identical to password login |
| Error mapping | a rejected token is `401 INVALID_CREDENTIALS` and creates nothing; **unreachable Google is `503`** |
| OAuth-only accounts | cannot password-log-in; **the null hash does not crash the login path**; the error is identical to an unknown address |
| HTTP | the `id_token` reaches the service; **an `email` in the body does not survive parsing**; the cookie attributes; missing and oversized tokens are 400; 503 maps to `SERVICE_UNAVAILABLE` |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| The identity comes from a Google signature, not the request | `docs/SECURITY/03` | "the email in the request body has no influence on the identity" and "an email in the body does not survive parsing". Structural too: the service takes one opaque string |
| The token's audience is ours | `docs/SECURITY/03` | "passes our client id as the audience". **Mutation**: deleting the `audience` option fails that test. *It does not fail "a token for another audience is refused"* — that test asserts the library's behaviour given a wrong-audience error, not that we ask for the check. Stated precisely because the difference matters |
| An unverified Google email cannot take over an account | — | "an unverified Google email cannot claim an existing account". **Mutation**: accepting `email_verified: false` fails that test and "…cannot register either" |
| One Google identity, one account | ADR-049 | "one Google identity cannot attach to two accounts" — asserts `23505` on `idx_users_oauth`, at the database, so it holds for a hand-run data fix too |
| An OAuth-only account is not a password-login oracle | DoD item 3 | "gives the same error as a genuinely unknown address" — same code and same message |
| A null `password_hash` does not crash login | Card step 5 | "the null password hash does not crash the login path" — a 401, not a 500 |
| No `id_token` reaches a log | `docs/DEVOPS/06` | "never carries the token out of the library, in message OR reason". **This was a real defect, not a precaution** — see below |
| Expired and wrongly-signed tokens are refused | DoD item 1 | Six classification cases, plus the `503`/`401` split |

## Abuse Cases Covered

Every row of the spec's § 11 table has a named test.

## DoD Verification

- [x] An `id_token` with a wrong audience, bad signature, or past expiry is rejected. Six classification tests plus the audience test, and the mutation that removes the audience argument.
- [x] An email in the request body has no influence on the resulting identity, proven by a test that sends a mismatched one. Two tests, at the service and at HTTP.
- [x] An OAuth-only account cannot be used for password login and produces a clear, non-enumerating error. Three tests, including that the error is byte-identical to the one for an unknown address.

## What Did Not Work

**1. The verifier was leaking the `id_token` into the log stream.** `google-auth-library`
throws `new Error('Invalid token signature: ' + jwt)` — the entire token in the message —
and three of its other messages embed `JSON.stringify(payload)`, which contains the user's
email address. The first version of `classify()` put that message into
`InvalidGoogleTokenError.reason`, and `GoogleOAuthService` logs `reason` on a security
event. A live bearer credential would have gone to the log stream on every failed sign-in
with a malformed token.

`P0-12`'s redaction could not have caught it: redaction works on **key names**, and the
value would have arrived inside a string called `reason`. The classifier now maps each
pattern to a fixed slug (`bad_signature`, `wrong_audience`, …) and the library's message is
matched and discarded. Two tests assert it, using the library's real message text.

Found by reading the library's source to get the message wordings right — not by a test,
and not by review.

**2. A test caught an invented message.** `"a wrong issuer is an InvalidGoogleTokenError"`
failed because the pattern list said `/wrong issuer/i` while the library says
`Invalid issuer, expected one of [...]`. The pattern was wrong, not the test; it was fixed
by reading `oauth2client.js` rather than by loosening the assertion.

**3. `.catch((e) => e as SomeError)` does not narrow.** It types as
`Result | SomeError`, so every property access after it is an error — and casting past
that would also hide the case where the call unexpectedly *resolves*, which is the one
outcome such a test must never pass on. Extracted `test/support/rejection.ts`, which
narrows and throws if nothing was thrown.

**4. The full integration suite needs a real Postgres, and 5432 was occupied.** Six schema
suites predate the Testcontainers harness and use `helpers.ts`, which connects to
`localhost:5432` and deliberately fails rather than skipping. Something else on this
machine holds 5432 and 6379. Run it as:
`POSTGRES_PORT=55432 docker compose -f deploy/docker-compose.yml up -d postgres`, then
export `MIGRATION_DATABASE_URL`/`DATABASE_URL` against `localhost:55432`. All 276 pass that
way.

## Follow-Ups and Open Questions

- **Nobody is told their account was linked.** `P4-06` owns email delivery. Linking a
  sign-in method to an existing account is exactly the event a user should hear about, and
  the notification is a follow-up rather than an omission.
- **`GOOGLE_OAUTH_CLIENT_ID` is not set anywhere.** Until it is, `POST /auth/oauth/google`
  answers `503` naming the variable. Nothing else is affected.
- **`P1-20` (auth screens) needs the Google Sign-In SDK** to obtain the `id_token`; this
  endpoint is the whole backend half.
- **The failure classification is message-based** and will drift when
  `google-auth-library` rewords something. It fails safe — an unknown message becomes a
  503, not an acceptance — and `"an unrecognised failure fails SAFE, not open"` is the test
  that pins that direction.

## What to Watch

**A rise in `auth.oauth_provider_unavailable`** after a `google-auth-library` upgrade is
most likely a reworded message rather than a Google outage. The `reason` slugs on
`auth.login_failed` are the other half of that signal: if rejections stop appearing and
unavailability starts, the pattern list needs updating.

**The unique index can reject a write that used to succeed.** Nothing writes those columns
except this service, but a future admin tool or import that sets `oauth_subject_id` will
meet `23505` rather than silently creating an ambiguous login. That is the intent.
