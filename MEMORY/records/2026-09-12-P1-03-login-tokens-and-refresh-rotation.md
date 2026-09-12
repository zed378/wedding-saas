# P1-03 — Login, access tokens, refresh rotation

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-03 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-03-login-tokens` |
| **Status** | Completed |
| **Spec** | [`MEMORY/specs/P1-03-login-tokens-and-refresh-rotation.md`](../specs/P1-03-login-tokens-and-refresh-rotation.md) |

---

## What Changed

`POST /auth/login`, `/auth/refresh`, `/auth/logout` and `GET /auth/me`. A 15-minute HS256
access token, and a 256-bit opaque refresh token in an `HttpOnly; Secure; SameSite=Lax`
cookie that rotates on every use and, when a spent one is presented again, takes every
session that user has with it.

Three supporting pieces: `SessionService` (the answer to "who is this request from", which
`P1-06` will turn into middleware), the refresh cookie's attributes in one file, and
`cookie-parser` in the middleware chain.

## Why

`docs/API/01` § Token Strategy and `docs/SECURITY/03` § Tokens. The card calls reuse
detection "the single highest-value behaviour in the task" and that is right: everything
else here is plumbing that many services get right, and this is the part that turns a
stolen session from an indefinite compromise into one that ends the next time either party
uses it.

## How

**The token says who; the database says what they may do.** `SessionService.authenticate`
verifies the signature and then reads the user row, returning *its* `role`, `status` and
`email_verified` — never the token's copies. `docs/SECURITY/01` § Elevation of Privilege
requires a suspension or a role change to take effect before the access token expires, and
15 minutes of a suspended user still working is 15 minutes of an incident still running.
It costs one primary-key lookup per request.

**Rotation and issuance are one transaction.** The card's step 4. A crash between them
would otherwise leave the session dead with no successor, or — with the order reversed —
two live tokens for one session.

**Reuse detection revokes the user, because the schema has no narrower unit.**
`docs/DATABASE/02` gives `refresh_tokens` no family column and `docs/SECURITY/03` says
"ALL of that user's active sessions". Inventing a `family_id` would have been inventing a
rule the specification does not state.

**The cookie is the only channel for the refresh token.** `docs/API/01` writes it as a
body field with "(ideally via an HTTP-only cookie)" beside it. A body fallback would make
the "ideally" optional in practice — a client could keep the token in `localStorage`, and
`HttpOnly` would be protecting a value the client also holds in the clear.

**`SameSite=Lax` rather than `Strict`**, per `docs/SECURITY/03`, and the reason is written
at the call site: `Strict` withholds the cookie on a top-level navigation from an email
link, so a user following a verification link would arrive logged out.

**A pepper on the refresh hash, not on the single-use tokens** (ADR-048). The refresh token
*is* the session — thirty days, no password — so a table leak must not yield working
credentials. `HMAC-SHA256` with an environment-resident pepper costs one HMAC.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/auth/tokens/access-token.service.ts` | **New** — sign and verify, HS256 pinned |
| `backend/api/src/modules/auth/tokens/refresh-token.service.ts` | **New** — issue, rotate, revoke, family revocation |
| `backend/api/src/modules/auth/session.service.ts` | **New** — bearer -> user, from the database |
| `backend/api/src/modules/auth/login.service.ts` | **New** — login, refresh, logout |
| `backend/api/src/modules/auth/refresh-cookie.ts` | **New** — the cookie attributes, once |
| `backend/api/src/modules/auth/auth.controller.ts` | Four endpoints added |
| `backend/api/src/http/errors.ts` | `UnauthenticatedError` takes a closed-union code, for `INVALID_CREDENTIALS` |
| `backend/api/src/config/env.schema.ts` | Auth secrets required, `min(32)` |
| `backend/api/src/config/secret-rules.ts` | Production length rule replaced by a placeholder rule |
| `backend/api/src/main.ts` | `cookie-parser`, unsigned |
| `backend/api/test/access-token.spec.ts` | **New** — 20 tests, mostly negative |
| `backend/api/test/auth-http.spec.ts` | **New** — 18 tests, the cookie header and the envelope |
| `backend/api/test/integration/auth-session.itest.ts` | **New** — 36 tests |
| `.env.example`, `deploy/SECRETS.md` | The two secrets, and what rotating them costs |
| `backend/api/package.json` | `jose`, `cookie-parser` |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| `jose`, not `jsonwebtoken` or hand-rolled | Algorithm confusion is the JWT vulnerability class, and `jose` makes the algorithm list an argument rather than an option to forget | ADR-046 |
| Auth secrets required at 32 characters in every environment | A short HMAC key is brute-forceable offline wherever it runs, and dev is where the short one comes from | ADR-047 |
| Refresh hash is peppered; `user_tokens` is not | The refresh token is the session; a verification token is 24 hours of confirming an address that was already yours | ADR-048 |
| A suspended account gets `403`, not the generic `401` | Only someone who already supplied the correct password reaches that branch, so it is not an enumeration oracle | — |
| The database is re-read on every authenticated request | `docs/SECURITY/01`. No cache, so there is nothing to forget to invalidate | — |
| Reuse detection has no grace window | `docs/SECURITY/03` states the rule without qualification; a window is a deliberate weakening and is not mine to add | OQ-21 |

## Deviations from `docs/`

**One, and it is a narrowing.** `docs/API/01` writes `POST /auth/refresh { refresh_token }`
with "(ideally via an HTTP-only cookie)". The endpoint accepts no body at all. Recorded
here rather than in the document because the document's own parenthetical is what is being
followed; the narrowing is the removal of the weaker alternative it offers.

## Tests Added

74 (38 unit, 36 integration). API unit total 135 → 173; integration 213 → 249.

| Group | Cases |
|---|---|
| Access token | round trip; 15-minute expiry either side of the boundary; a key under 32 characters refused on both sides |
| **Forgery** | signed with another key; **`alg: none`**; **`alg: HS512`**; tampered payload; wrong issuer; five malformed shapes |
| Required claims | six validly-signed tokens missing or mistyping `sub`, `role`, `email_verified` |
| Uniform rejection | expired, forged and garbage produce one message and one error name |
| Login | success; case-insensitive address; **unknown email and wrong password identical in code, status and message**; **and comparable in time**; unverified may log in; suspended refused with 403 and issued nothing; two logins leave two sessions |
| The refresh token | stored only as a peppered hash, and a different pepper does not reproduce it; 30-day life; **never in a response body** |
| Rotation | the presented token dies and the successor works; **exactly one live token per session**; the new access token carries the current role; unknown, absent and expired refused; **two simultaneous rotations yield one winner** |
| **Reuse** | **a replayed token revokes every session, including a device the attacker never touched**; `auth.token_reuse_detected` emitted with the count; an expired-but-never-revoked token is *not* reuse |
| Logout | ends that session server-side; leaves others alone; silent for unknown; a replay after logout is treated as theft (recorded, not incidental) |
| HTTP layer | the documented body shape; **the refresh token is never in it**; `Set-Cookie` carries `HttpOnly`, `Secure`, `SameSite=Lax` and the narrow path; **a refresh token in the body is ignored**; logout clears the cookie with matching attributes; `/me` leaks no password or oauth field |
| The database is the authority | **role from the row, not the token**; `email_verified` likewise; **a suspended user refused before expiry**; suspended cannot refresh and the successor is revoked; soft-deleted refused; orphan token refused; five malformed headers |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| Reuse of a revoked refresh token revokes the family and emits an event | `docs/SECURITY/03` § Tokens | "a replayed refresh token revokes every session" and "emits auth.token_reuse_detected". **Mutation**: removing `isNull(revokedAt)` from the rotation `UPDATE` fails 5 tests including both of those |
| A role claim cannot be trusted | `docs/SECURITY/01` § Elevation of Privilege | "the role comes from the database, not the token". **Mutation**: returning `claims.role` from `authenticate` fails that test and "email_verified comes from the database too" |
| A forged or unsigned token is refused | OWASP / `docs/SECURITY/03` | "a token signed with another key is refused", "an unsigned token is refused", "a token whose algorithm is not HS256 is refused" |
| A suspended user cannot keep working | `P1-03` DoD item 3 | "a suspended user is refused before the token expires" — the access token in that test is seconds old and valid |
| Login does not reveal whether an address exists | `docs/API/01` § Error Cases | "an unknown email and a wrong password are indistinguishable" asserts code, status **and** message; a second test asserts comparable duration |
| Refresh tokens are stored hashed | `docs/SECURITY/03` | "is stored only as a peppered hash" — asserts 64 hex, not equal to the token, equal to `hashRefreshToken(PEPPER, …)`, and **not** equal under another pepper |
| The refresh token is `HttpOnly; Secure; SameSite=Lax` | `docs/SECURITY/03` § Tokens | Three cases in `auth-http.spec.ts`, one per attribute, reading the raw `Set-Cookie` header — the only place these exist. **Mutation**: `httpOnly: false` + `sameSite: "none"` fails 4 tests, naming the attributes |
| No token reaches a log | `docs/DEVOPS/06` | `token`, `tokenhash` and `authorization` are in `REDACTED_KEY_NAMES` from `P0-12`. The login-failure event carries a SHA-256 of the email, never the address |

## Abuse Cases Covered

Every row of the spec's § 11 table has a named test.

## DoD Verification

- [x] Refresh tokens are stored hashed and rotate on every use.
- [x] Reusing a revoked refresh token revokes the whole family and emits a security event, proven by a test — and by the mutation that makes that test fail.
- [x] A suspended user's next authenticated request fails without waiting for token expiry.
- [x] The access token never appears in a response body destined for persistent client storage, and never in a log. The body is `{ access_token, user }`; `@wi/api-client`'s store is a closure variable with no persistent branch (`P0-22`), and `scripts/check-token-storage.mjs` fails the build on a write to `localStorage`.

## What Did Not Work

**1. A misconfigured signing key was reported as an invalid token.** `encodeKey` was called
inside `verifyAccessToken`'s `try`, so a `JWT_SIGNING_KEY` under 32 characters surfaced as
`InvalidAccessTokenError` — every user's session failing to authenticate, with no signal
pointing at an environment variable. Caught by the test written for it ("refuses a key
shorter than 32 characters, on both sides"), which expected a message the code could not
produce. The key is now computed before the `try`.

**2. The production-only key-length rule became a lie.** Making the schema require 32
characters everywhere left `checkSecretRules` with a rule `loadEnv` could never reach, and
a test asserting "does not apply the length rule outside production" — which had just
stopped being true of the system. Replaced with a rule the schema genuinely cannot express
(the `.env.example` placeholder in production), and the test now asserts where the length
check actually lives.

**3. `jose@6` is ESM-only and this package is CommonJS.** Rather than assume, the import
was probed against the built `dist/` output under plain `node`, because Vitest loads ESM
natively and would have been green either way — which is exactly how `P0-19.1`'s
`import.meta` bug reached a running container. It works, through Node 24's `require(esm)`.

## Follow-Ups and Open Questions

- **Staging will not boot until two secrets are generated on the host.** `JWT_SIGNING_KEY`
  and `REFRESH_TOKEN_PEPPER` are now required; the VM has neither. Exit 78 naming both.
  `openssl rand -base64 48` twice, appended to the mode-600 `.env`.
- **`OQ-21` — should rotation have a grace window?** Two legitimate concurrent refreshes are
  indistinguishable from theft and will log the user out everywhere. Implemented strictly
  as `docs/SECURITY/03` describes; raised rather than decided.
- **`P1-06` inherits `SessionService`** and must not add a cache without invalidating it
  from the admin suspend path (`P6-04`); "a suspended user is refused before the token
  expires" is the test that would catch forgetting.
- **`P1-07` consumes `auth.login_failed`**, which already carries `email_sha256` and
  `known_account` for exactly that.

## What to Watch

**The per-request user lookup.** One indexed primary-key read on every authenticated
request, deliberately uncached. If it becomes a problem, the cache has to be invalidated by
suspension, and the failure mode of forgetting is a suspended user who keeps working —
silent, and exactly what `docs/SECURITY/01` forbids.

**Users reporting random logouts.** That is `OQ-21`, and it will look random because it
depends on tab timing. Check for `auth.token_reuse_detected` without a corresponding
incident before concluding anything was stolen.

**`REFRESH_TOKEN_PEPPER` is not rotatable** without ending every session. Recorded in
`deploy/SECRETS.md`; the temptation to rotate it "for hygiene" alongside other secrets is
the thing to watch for.
