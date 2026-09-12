# P1-03 — Feature Spec: Login, Access Tokens, Refresh Rotation

| | |
|---|---|
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-03 |
| **Date** | 2026-09-12 |
| **Author** | Claude Code session |
| **Status** | Draft |

---

## 1. Goal

Someone who registered can log in, stay logged in for thirty days without re-entering a
password, and be logged out everywhere the moment a stolen session is detected or an
administrator suspends them.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/01` | Endpoints | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me` |
| `docs/API/01` | Token Strategy | 15-minute JWT with `user_id`, `role`, `email_verified`; opaque 30-day refresh in an `HttpOnly` cookie, rotated on every use |
| `docs/API/01` | Error Cases | `401 INVALID_CREDENTIALS`, generic, never distinguishing unknown email from wrong password |
| `docs/SECURITY/03` | Tokens | Hashed refresh tokens; reuse of a revoked one revokes **all** of that user's sessions |
| `docs/SECURITY/01` | Elevation of Privilege | `role` is re-read from the database on privileged operations, not trusted from the token |
| `docs/DATABASE/02` | `refresh_tokens` | `token_hash`, `expires_at`, `revoked_at` — no family column, so the family **is** the user |
| `docs/DEVOPS/06` | — | Token reuse is a security event, 1-year retention |

**One contradiction found, and it is not between two documents — it is between a document
and concurrency.** See § 14.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| — | A suspended user cannot authenticate, and cannot keep using an access token issued before the suspension | `SessionService.authenticate`, which re-reads the row |
| — | A refresh token is usable exactly once | The conditional `UPDATE`, as in `P1-02` |
| — | Presenting a revoked refresh token ends every session that user has | `RefreshTokenService.rotate` |

## 4. API Contract

```
POST /api/v1/auth/login    { email, password }  -> 200 { access_token, user }   + Set-Cookie
POST /api/v1/auth/refresh  (cookie)             -> 200 { access_token, user }   + Set-Cookie
POST /api/v1/auth/logout   (cookie)             -> 200 { message }              + cleared cookie
GET  /api/v1/auth/me       (Bearer)             -> 200 { user }
```

The response body is `docs/API/01` § Example Response verbatim: `access_token` and a
`user` object. **The refresh token is not in it.** The document says "ideally via an
HTTP-only cookie"; this implementation is not ideal-if-convenient about it — the cookie is
the only channel, and `POST /auth/refresh` ignores a body entirely. A refresh token a
client can read is a refresh token an XSS can read, and it is the credential with the
thirty-day life.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `users` | Read | Password hash, role, status, `email_verified` |
| `users` | Write | `password_hash` only, and only when `needsRehash` says the parameters moved |
| `refresh_tokens` | Write, Update | Issue, rotate, revoke |

**Migration required: no.** `refresh_tokens` exists from `P0-07` exactly as
`docs/DATABASE/02` specifies it.

**There is no `family_id` column, and none is being added.** `docs/SECURITY/03` defines
the blast radius as "ALL of that user's active sessions", so the family is the user. A
narrower family would be a rule the specification does not state.

## 6. Authorization

`login`, `refresh` and `logout` require no access token; `refresh` and `logout` authorise
by possession of the cookie. `GET /auth/me` requires a valid access token.

**The access token's claims are not the authority on anything but identity.** `role`,
`status` and `email_verified` are re-read from the database on every authenticated
request (`docs/SECURITY/01` § Elevation of Privilege). The claims travel in the token so a
future cache-only path could skip the query, but nothing skips it today.

## 7. Validation and Sanitization

| Field | Rule |
|---|---|
| `email` | Valid address, at most 255 characters, lowercased |
| `password` | Present. **Not** policy-checked — the policy applies to a password being *set*, and running it at login would lock out users whose stored password predates a rule change |

## 8. State Transitions

`refresh_tokens.revoked_at`: `NULL -> timestamp`, once. Three things cause it — rotation,
logout, and a family revocation — and only the third is a security event.

## 9. Side Effects

| Effect | When | Why there |
|---|---|---|
| `auth.login_failed` security event | Every failed login | `docs/SECURITY/03` § Logging. Feeds `P1-07`'s lockout |
| `auth.token_reuse_detected` security event | Reuse of a revoked refresh token | The highest-signal event in the auth system |
| Password re-hash | Login, when `needsRehash` is true | `P1-01` left this obligation on this card |

## 10. Failure Modes

| Failure | Behaviour |
|---|---|
| Unknown email | `401 INVALID_CREDENTIALS`, after a dummy argon2 verify so the timing matches |
| Wrong password | `401 INVALID_CREDENTIALS`, identical |
| Suspended account, correct password | `403 FORBIDDEN`. Distinct on purpose — see below |
| No refresh cookie | `401 UNAUTHENTICATED` |
| Expired refresh token | `401`. Not reuse: expiry is not evidence of theft |
| Revoked refresh token | `401`, **and every other session is revoked** |
| Access token expired, malformed, or signed with another key | `401` |

**Why a suspended account gets a distinct error.** The generic login error exists to stop
enumeration, and enumeration is done by an attacker who does *not* know the password.
Someone who reaches this branch has already supplied it, so the distinction reveals
nothing they could not confirm another way — while telling the real user "incorrect email
or password" when their password was correct produces a support ticket and a password
reset that will not help.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Stolen refresh token replayed after the victim refreshed | `docs/SECURITY/03` | Every session revoked, `auth.token_reuse_detected` emitted | "a replayed refresh token revokes every session" |
| Forged JWT with `role: admin` | `docs/SECURITY/01` | Signature check fails | "a token signed with another key is refused" |
| `alg: none` JWT | OWASP | Refused | "an unsigned token is refused" |
| `alg` switched to another algorithm | OWASP | Refused | "a token whose algorithm is not HS256 is refused" |
| Role escalated inside a validly-signed token | `docs/SECURITY/01` | The claim is ignored; the database is the authority | "the role comes from the database, not the token" |
| User suspended mid-session | `P1-03` DoD | The next request fails, without waiting for expiry | "a suspended user is refused before the token expires" |
| Login enumeration by response | `docs/API/01` | Identical code, message and shape | "an unknown email and a wrong password are indistinguishable" |
| Login enumeration by timing | `docs/SECURITY/03` | Comparable duration | "an unknown email costs about as much as a wrong password" |
| Refresh token read from JavaScript | `docs/SECURITY/03` | `HttpOnly`, and never in a body | "the refresh token never appears in a response body" |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit — access tokens | round trip; expiry honoured; wrong key; `alg: none`; algorithm substitution; tampered payload; missing claims |
| Integration — login | success; unknown email; wrong password; suspended; an unverified user may still log in; re-hash when parameters moved |
| Integration — refresh | rotation kills the old token; the new one works; **reuse revokes the family**; expired; unknown; a suspended user cannot refresh |
| Integration — logout | that session stops working; other sessions survive |
| Integration — me | returns the database's role, not the token's; a suspended user is refused |
| Mutation | drop `isNull(revokedAt)` from the rotation `UPDATE` and confirm the reuse test fails; return the token's `role` instead of the row's and confirm the escalation test fails |

## 13. Observability

- `auth.login_failed` carries the email **hashed**, never in plaintext. An aggregator needs
  to count attempts per account without holding a list of addresses.
- `auth.token_reuse_detected` carries the user id and how many sessions were revoked.
- No access token, refresh token or hash is logged; `token`, `tokenhash` and
  `authorization` are all in `REDACTED_KEY_NAMES` from `P0-12`.

## 14. Open Questions

- **Two legitimate concurrent refreshes are indistinguishable from theft.** A browser with
  two tabs, or a client retrying a timed-out refresh, presents the same refresh token
  twice; the second presentation finds it revoked and — following `docs/SECURITY/03` to
  the letter — logs the user out of everything. The usual mitigation is a short grace
  window in which a just-rotated token returns its successor again instead of raising the
  alarm. The document does not mention one, so none is implemented. **Raised as `OQ-21` in
  `TASKS/BACKLOG.md` rather than decided here.**
- **`JWT_SIGNING_KEY` and `REFRESH_TOKEN_PEPPER` become required.** Both were optional
  because nothing used them. Staging has neither and will refuse to boot until they are
  generated on the host — recorded as a deployment follow-up, not silently deferred.
