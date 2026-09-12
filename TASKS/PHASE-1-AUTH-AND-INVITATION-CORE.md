# Phase 1 — Auth and Invitation Core

**Goal**: a registered user can create an invitation from a template, fill in every entity in `docs/PLAN/08-INVITATION-DATA-MODEL.md`, upload photos through a validated pipeline, and have all of it autosave — with object-level authorization on every endpoint from the first one.

**Why this ordering**: `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` Phase 1 pairs auth with invitation CRUD and the media pipeline, and puts the editor UI here without live preview, which arrives in Phase 2. The data domain comes before the presentation layer deliberately — the roadmap's stated principle is "data domain first, then architecture, then UI".

**Security posture for this phase**: every task that adds an `:id` endpoint inherits global DoD item 2 (the IDOR test). `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` is the governing document for this entire phase, and `P0-11`'s repository layer is what makes satisfying it routine rather than heroic.

**Exit criteria**: registration through to a fully populated draft invitation works end to end; two users cannot see each other's anything; a photo uploaded with a spoofed extension is rejected; the editor autosaves without data loss across a long editing session.

**Roadmap reference**: `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` § Phase 1 (Week 3-5).

---

## Task Summary

| ID | Task | Surface | Size | Depends on |
|---|---|---|---|---|
| P1-01 | Password hashing and password policy | backend | M | P0-07, P0-19 |
| P1-02 | Registration and email verification tokens | backend | M | P1-01, P0-15 |
| P1-03 | Login, access tokens, refresh rotation | backend | L | P1-01 | ✅
| P1-04 | Google OAuth | backend | M | P1-03 | ✅
| P1-05 | Forgot and reset password | backend | M | P1-03, P0-15 | ✅
| P1-06 | Auth, role and ownership middleware | backend | L | P1-03, P0-11 | ✅
| P1-07 | Rate limiting for auth and general API | backend | M | P1-03 | ✅
| P1-08 | User profile, preferences, account deletion | backend | M | P1-06 |
| P1-09 | Create an invitation | backend | M | P1-06, P0-20 | ✅
| P1-10 | Invitation list, detail, update, soft delete | backend | L | P1-09 | ✅
| P1-11 | Couple sub-resource | backend | M | P1-10 | ✅
| P1-12 | Events sub-resource | backend | M | P1-10 | ✅
| P1-13 | Bank accounts and quote sub-resources | backend | M | P1-10 | ✅
| P1-14 | Settings sub-resource and slug rules | backend | M | P1-10 | ✅
| P1-15 | Change template without data loss | backend | M | P1-10, P0-20 |
| P1-16 | Free-text sanitization pipeline | backend | M | P0-13 | ✅
| P1-17 | Media upload — synchronous validation stage | backend | L | P1-10, P0-16 |
| P1-18 | Media processing worker | worker | L | P1-17, P0-15 |
| P1-19 | Gallery sub-resource, reorder, cover, quota | backend | M | P1-18 |
| P1-20 | Frontend — authentication screens | web-app | M | P0-22, P1-03 |
| P1-21 | Frontend — dashboard and creation wizard | web-app | L | P1-20, P1-09 |
| P1-22 | Frontend — editor shell, store, autosave | web-app | L | P1-21, P1-10 |
| P1-23 | Frontend — schema-driven properties panel | web-app | L | P1-22, P0-20 |
| P1-24 | Frontend — media manager and map picker | web-app | L | P1-23, P1-19 |
| P1-25 | Phase 1 test suite and acceptance | all | L | all above |

**Critical path**: `P1-03` → `P1-06` → `P1-09` → `P1-10` → everything else. The ownership middleware and invitation CRUD block the most downstream work; give them the most review attention.

---

## P1-01 — Password Hashing and Password Policy

| | |
|---|---|
| **Status** | DONE — 2026-09-11 |
| **Depends on** | P0-07, P0-19 |
| **Spec refs** | `docs/SECURITY/03-AUTHENTICATION-SECURITY.md` § Password, `docs/DATABASE/02-USERS.md` § Notes |
| **Spec required** | Yes — authentication |
| **Surface** | backend |

**Goal** — Passwords are stored as argon2id hashes with parameters measured on the target hardware, and the policy is enforced server-side.

**Steps**
1. Implement hashing with argon2id (bcrypt cost ≥ 12 is the documented fallback).
2. Measure parameters on hardware resembling the deployment target rather than copying values from a blog post; aim for a per-hash cost that is meaningful but survives the login rate the service expects.
3. Enforce the policy from `docs/SECURITY/03`: minimum 8 characters, no restrictive maximum so passphrases work, and — recommended there — a breached-password check via a k-anonymity API.
4. Decide the failure mode for the breached-password check when the third-party is unreachable, and record it as an ADR. Failing closed blocks legitimate registrations during someone else's outage; failing open silently weakens the control. If it fails open, it must emit an audit event and a metric so the gap is visible.
5. Make the verification path do equal work for a non-existent user, so response time does not reveal which email addresses have accounts.
6. Unit test: correct password verifies, wrong fails, hash format is argon2id, a policy violation is rejected with a field-level error, and timing does not diverge between unknown-user and wrong-password paths.

**Definition of Done**
- [x] This task writes no column; the redactor covers the log path (`password` is in `REDACTED_KEY_NAMES` since `P0-12`), and a test asserts the plaintext appears in none of the messages the policy produces.
- [x] **ADR-045**, with the full measurement grid — run on the `P0-23` deployment host itself rather than on something resembling it. 64 MiB / t=3 / p=1 at **277 ms**.
- [x] **ADR-044**: fails **open**, and emits `auth.breach_check_unavailable`. `checkBreached` reports `unavailable` as a value distinct from `safe`, which is what makes the decision observable rather than invisible.
- [x] Passes — and fails under two separate mutations, which is the part worth stating.

**A mutation disproved a claim in the spec.** It predicted that removing the `null` guard in `verifyPassword` would fail "a null hash never verifies". It does not: `argon2.verify(null, …)` throws, the `catch` returns `false`, and the test passes — the right answer, far too quickly. The **timing** tests are what catch it. So that guard is a timing control and the correctness test protects nothing about it; both files now say so, because the next person to simplify that branch will be right about the behaviour and wrong about the consequence.

**`p=1` although `p=2` is measurably faster** (162 ms vs 277 ms). Parallelism spends cores per hash, and the host has four shared with eight other compose projects. One core per login is predictable; latency is not the binding constraint at this login rate.

**argon2's install script is denied**, verified by hashing a password with `--ignore-scripts` on the dev machine **and on `node:24-alpine`**. Musl prebuilds are frequently missing where glibc ones are present, and a binding that loads on a laptop but not in the container is a `P0-19`-shaped failure discovered at deploy time.

**Abuse cases to test**
| Abuse case | Source | Expectation |
|---|---|---|
| User enumeration through response timing | `docs/SECURITY/03` § Login Rate Limiting | Timing indistinguishable |
| Trivial password accepted | `docs/SECURITY/03` § Password | 400 with a field error |

---

## P1-02 — Registration and Email Verification

| | |
|---|---|
| **Status** | DONE — 2026-09-11 |
| **Depends on** | P1-01, P0-15 |
| **Spec refs** | `docs/API/01-AUTHENTICATION.md` § Registration Flow, `docs/PLAN/01-PRODUCT-REQUIREMENTS.md` FR-1.1, `docs/SECURITY/03` § Email Verification |
| **Spec required** | Yes — authentication |
| **Surface** | backend |

**Goal** — `POST /auth/register` creates an unverified user and sends a verification email asynchronously, and verification is required for publish and checkout but not for drafting.

**Steps**
1. Implement register, verify-email and resend-verification per `docs/API/01`.
2. Create the user with `email_verified = false`; emit a `user.registered` event; the notification worker sends the mail (`docs/BACKEND/07`). Registration does not block on email delivery.
3. Use `user_tokens` (`docs/DATABASE/02` § Single-Use Token Table, added by ADR-020): hashed token, `type = 'email_verification'`, 24-hour expiry, `used_at` set on redemption inside the same transaction as the effect so a replay is a no-op.
4. Set the 24-hour expiry from `docs/SECURITY/03`, single use.
5. Enforce the gating rule from `docs/API/01` step 2 in the **publish and order services**, not in a middleware that could be forgotten: unverified users may create and edit drafts; `POST /publish` and `POST /orders` return 403 `EMAIL_NOT_VERIFIED`.
6. Create the `user_notification_preferences` row at registration, so no later code has to handle its absence.
7. Rate limit registration per `docs/SECURITY/10` (5 per hour per IP) — wired in `P1-07`, referenced here.

**Definition of Done**
- [x] SHA-256 of a 256-bit random value, 24-hour expiry, and single use enforced by a conditional `UPDATE ... WHERE used_at IS NULL` rather than a read-then-write — so two simultaneous clicks race in the database. A test runs both redemptions concurrently and asserts exactly one wins.
- [x] Proven with a queue that throws: the user still exists, because the enqueue happens after the transaction commits.
- [ ] **Partially met.** `requireVerifiedEmail` exists and is tested, but `POST /publish` (`P3-06`) and `POST /orders` (`P3-01`) do not exist yet, so there is nothing to test against. **Obligation recorded on both cards.**
- [x] A duplicate returns the identical `201`. The password policy and the argon2 hash both run *before* the existence check, so the two paths cost the same 277 ms — otherwise the response time would say what the status code was careful not to.

**The real owner still gets an email** when someone tries to register with their address. Without it the attacker learns nothing and neither does the one person entitled to know.

**Three pieces of infrastructure came with this**: the API's queue producer (`P0-15` built the worker, not the producer), the single-use token service, and `REDIS_URL` — which the environment schema named in a comment but never declared, so nothing validated it.

---

## P1-03 — Login, Access Tokens, Refresh Rotation

| | |
|---|---|
| **Status** | **DONE** 2026-09-12 — [record](../MEMORY/records/2026-09-12-P1-03-login-tokens-and-refresh-rotation.md) |
| **Depends on** | P1-01 |
| **Spec refs** | `docs/API/01-AUTHENTICATION.md` § Token Strategy, `docs/SECURITY/03-AUTHENTICATION-SECURITY.md` § Tokens, `docs/DATABASE/02-USERS.md` |
| **Spec required** | Yes — authentication |
| **Surface** | backend |

**Goal** — Short-lived access tokens plus rotating refresh tokens in an HTTP-only cookie, with reuse detection that revokes a whole session family.

**Steps**
1. Implement login, refresh, logout and `GET /auth/me` per `docs/API/01`.
2. Issue a 15-minute access token carrying `user_id`, `role` and `email_verified`.
3. Issue a 256-bit random refresh token, store only its hash in `refresh_tokens`, and set it as `HttpOnly; Secure; SameSite=Lax` with a 30-day expiry.
4. Rotate on every use: mark the presented token `revoked_at` and issue a new one in the same transaction, so a crash cannot leave two live tokens.
5. Implement reuse detection: presenting an already-revoked token means the token was stolen — revoke every active refresh token for that user, log a security event, and force re-authentication. This is the single highest-value behaviour in the task.
6. Return the generic error from `docs/API/01` § Error Cases for bad credentials, never distinguishing unknown email from wrong password.
7. Re-read `role` from the database on privileged operations rather than trusting the token's claim alone, per `docs/SECURITY/01` § Elevation of Privilege — a role changed or a user suspended mid-session must take effect before the access token expires.
8. Logout revokes the refresh token server-side; discarding the cookie is not enough.

**Definition of Done**
- [x] Refresh tokens are stored hashed and rotate on every use. HMAC-SHA256 with a pepper (ADR-048); `"is stored only as a peppered hash"`, `"invalidates the presented token and issues a working successor"`.
- [x] Reusing a revoked refresh token revokes the whole family and emits a security event, proven by a test. `"a replayed refresh token revokes every session"` and `"emits auth.token_reuse_detected"`. **Mutation**: dropping `isNull(revokedAt)` from the rotation `UPDATE` fails 5 tests including both.
- [x] A suspended user's next authenticated request fails without waiting for token expiry. `"a suspended user is refused before the token expires"` — the access token there is seconds old and valid.
- [x] The access token never appears in a response body destined for persistent client storage, and never in a log. Body is `{ access_token, user }`; `@wi/api-client` holds it in a closure (`P0-22`) and `check-token-storage` fails the build on a write to browser storage.

**Open after this task**: `OQ-21` — two legitimate concurrent refreshes are indistinguishable from theft. Implemented strictly as `docs/SECURITY/03` states; raised, not decided.

**Abuse cases to test**
| Abuse case | Source | Expectation |
|---|---|---|
| Stolen refresh token replayed | `docs/SECURITY/03` § Tokens | All sessions revoked, security event logged |
| Forged JWT with `role: admin` | `docs/SECURITY/01` § Elevation of Privilege | Signature check fails; role also re-read from DB |
| Credential stuffing | `docs/SECURITY/10` | Rate limited (P1-07), generic error |

---

## P1-04 — Google OAuth

| | |
|---|---|
| **Status** | **DONE** 2026-09-12 — [record](../MEMORY/records/2026-09-12-P1-04-google-oauth.md) |
| **Depends on** | P1-03 |
| **Spec refs** | `docs/API/01-AUTHENTICATION.md` § Google OAuth, `docs/SECURITY/03` § Google OAuth, `docs/DATABASE/02-USERS.md` |
| **Spec required** | Yes — authentication |
| **Surface** | backend |

**Goal** — Sign-in with Google, where the identity comes from a server-verified `id_token` and nothing else.

**Steps**
1. Implement `POST /auth/oauth/google` accepting an `id_token`.
2. Verify the token server-side against Google's keys, checking issuer, audience, expiry and signature. `docs/SECURITY/03` is explicit: never trust an email from the request body.
3. Match on `(oauth_provider, oauth_subject_id)` first, then on verified email; link an existing password account only when the Google email is verified, and record the link.
4. Set `email_verified = true` for a Google-verified email, per `docs/API/01`.
5. Leave `password_hash` null for OAuth-only users; ensure the login endpoint handles that row without a null dereference.
6. Issue the same token pair as password login, so downstream code has one session model.

**Definition of Done**
- [x] An `id_token` with a wrong audience, bad signature, or past expiry is rejected. Six classification tests plus `"passes our client id as the audience"`. **Mutation**: deleting the `audience` argument fails that test.
- [x] An email in the request body has no influence on the resulting identity, proven by a test that sends a mismatched one. `"the email in the request body has no influence on the identity"` and `"an email in the body does not survive parsing"` — the schema has one field and Zod strips the rest.
- [x] An OAuth-only account cannot be used for password login and produces a clear, non-enumerating error. `"gives the same error as a genuinely unknown address"` — same code, same message — and `"the null password hash does not crash the login path"`.

**Answered here**: `OQ-15` — a Google identity is unique across active accounts (ADR-049, migration `0005`), because step 3 makes the subject id a login key. `docs/DATABASE/02` was updated to match.

---

## P1-05 — Forgot and Reset Password

| | |
|---|---|
| **Status** | **DONE** 2026-09-12 — [record](../MEMORY/records/2026-09-12-P1-05-forgot-and-reset-password.md) |
| **Depends on** | P1-03, P0-15 |
| **Spec refs** | `docs/API/01-AUTHENTICATION.md`, `docs/SECURITY/03` § Password Reset, `docs/SECURITY/10` |
| **Spec required** | Yes — authentication |
| **Surface** | backend |

**Goal** — A password reset that invalidates every existing session, on the assumption that a reset may be happening *because* the account is compromised.

**Steps**
1. Implement forgot-password and reset-password per `docs/API/01`, using the `user_tokens` table from `P1-02` with a 1-hour, single-use token.
2. Return the same response whether or not the email exists — no enumeration.
3. On a successful reset, revoke all refresh tokens for that user, per `docs/SECURITY/03`.
4. Rate limit to 3 per hour per (email, IP) — `docs/SECURITY/10`.
5. Send a notification to the account email that the password changed, so an unauthorized reset is visible to the real owner.

**Definition of Done**
- [x] Reset tokens are hashed, expire in an hour, and are single-use. `"is stored only as a hash"`, `"a reset token expires in an hour"`, `"a used reset token cannot be redeemed twice"`.
- [x] All sessions are revoked on reset, proven by a test that a pre-reset refresh token stops working. `"a pre-reset refresh token stops working"` and `"every device, not just the one that asked"`. **Mutation**: deleting the revocation `UPDATE` fails both. The revocation is in the **same transaction** as the password write.
- [x] Requesting a reset for an unknown email is indistinguishable from a known one, in both body and timing. `"an unknown address is indistinguishable from a known one"` and `"an unknown address costs about as much as a known one"`. The timing claim is bounded, not absolute — there is no expensive operation here to mirror, unlike `P1-01`'s dummy hash.

**Step 4 is deferred, not done.** Rate limiting to 3/hour per (email, IP) belongs to `P1-07`, which owns the mechanism; a bespoke limiter here would be a second implementation to keep in step. It is not a DoD item on this card. Recorded as an obligation on `P1-07`.

---

## P1-06 — Auth, Role and Ownership Middleware

| | |
|---|---|
| **Status** | **DONE** 2026-09-12 — [record](../MEMORY/records/2026-09-12-P1-06-auth-role-and-ownership-middleware.md) |
| **Depends on** | P1-03, P0-11 |
| **Spec refs** | `docs/SECURITY/04-AUTHORIZATION-RBAC.md`, `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`, `docs/PLAN/03-USER-ROLES.md` |
| **Spec required** | Yes — authorization |
| **Surface** | backend |

**Goal** — `requireAuth`, `requireRole` and `requireOwnership` exist as the documented trio, and the ownership check lives in the service layer where no caller can route around it.

**Steps**
1. Implement `requireAuth()`: validate the access token, load the current user, inject it into the request context, reject a suspended user.
2. Implement `requireRole(...roles)` for coarse category access.
3. Implement ownership as a **service-layer** concern built on `P0-11`, per `docs/SECURITY/04` § Implementation Principles 2 and 3: the service calls `findOwned(...)` and treats null as not-found. A controller-only check would be bypassed the first time a job or another module calls the service directly.
4. Return 404 for another user's resource, never 403 (`docs/SECURITY/04` note, `docs/SECURITY/05` checklist). Coordinate with `PG-01`.
5. Implement the admin bypass as the separately named path from `P0-11`, with an audit row on every use.
6. Write the reusable IDOR test helper on top of `createTwoTenants()`: given a method and a path template, assert 404 and an empty body for the other tenant. Every later endpoint task uses this one helper, which is what makes global DoD item 2 cheap enough to always honour.

**Definition of Done**
- [x] The three middlewares exist with the names in `docs/SECURITY/04`. `shared/auth-middleware/`. **`requireOwnership` is a function, not a guard** — the same document's Implementation Principle 2 requires ownership below HTTP, and a guard only runs on a request.
- [x] Ownership is enforced in the service layer, and a test calling the service directly (not through HTTP) still fails for a non-owner. The whole suite calls services directly; `"a non-owner gets 404 and no data"`. **Mutation**: removing the owner predicate from `findOwned` fails 7 tests.
- [x] Non-owner access returns 404 with no resource data. `"'absent' and 'not yours' are the same response"` asserts status, code **and** message.
- [x] The reusable IDOR test helper exists and is documented in the testing README. `test/support/idor.ts`, documented in the new `backend/api/test/README.md`. **Three of its own tests pass only when an assertion fails** — a helper that cannot fail proves nothing.
- [x] Admin bypass writes an audit row every time. Three tests, including the found-nothing case and the empty-reason refusal.

**Every later `:id` endpoint uses `expectIdorSafe`.** That is what makes global DoD item 2 cheap enough to always honour.

**Abuse cases to test**
| Abuse case | Source | Expectation |
|---|---|---|
| IDOR via path parameter | `docs/SECURITY/05` § 1 | 404, empty body |
| 403/404 discrepancy reveals existence | `docs/SECURITY/04` | Identical responses for "absent" and "not yours" |
| Service called from a job without a user context | `docs/SECURITY/04` § 2 | Explicit scope required; no implicit bypass |

---

## P1-07 — Rate Limiting

| | |
|---|---|
| **Status** | **DONE** 2026-09-12 — [record](../MEMORY/records/2026-09-12-P1-07-rate-limiting.md) |
| **Depends on** | P1-03 |
| **Spec refs** | `docs/SECURITY/10-ABUSE-PREVENTION.md` § Rate Limiting, `docs/API/00-API-STANDARDS.md` § Rate Limiting, `docs/ARCHITECTURE/06` |
| **Spec required** | Yes — abuse prevention |
| **Surface** | backend |

**Goal** — The rate limit table in `docs/SECURITY/10` implemented as configuration, with the standard headers, and a decided failure mode when Redis is unavailable.

**Steps**
1. Implement a sliding-window limiter in Redis, keyed per the table: login by (email, IP), register by IP, forgot-password by (email, IP), invitation creation by user, media upload by user, general authenticated by user, general public by IP.
2. Return `X-RateLimit-Limit`, `-Remaining`, `-Reset` and a 429 with the standard error envelope.
3. Keep limits in configuration, not constants — `docs/SECURITY/10` says the baseline will be tuned against real traffic post-launch.
4. Exempt the payment webhook path from general public limiting, per `docs/SECURITY/02` boundary 5 — a provider retry storm is legitimate traffic and must not be throttled into failure.
5. Decide and record the Redis-unavailable behaviour: fail open (no limiting, alert loudly) or fail closed (no logins). Recommendation on the card: fail open for general API traffic and fail **closed** for login and password reset, since the cost of unlimited credential attempts exceeds the cost of a login outage. Record as an ADR either way.
6. Implement escalating temporary blocks for repeat violators, per `docs/SECURITY/10` § Monitoring & Auto-block.
7. Add a metric for rate-limit hits per policy, for the `docs/DEVOPS/07` alert on brute-force patterns.

**Inherited obligation from `P1-05`** — `POST /auth/forgot-password` must be limited to **3 per hour per (email, IP)** (`docs/SECURITY/10`), with a test. `P1-05` implemented everything else on its card and deferred this one step here rather than building a second limiter.

**Definition of Done**
- [x] Every policy in `docs/SECURITY/10`'s table is implemented with its documented key and window. `"matches docs/SECURITY/10's table by default"` asserts all nine row for row. `reset-password` added as a documented addition — it consumes the link `forgot-password` sends.
- [x] Limits are configurable without a deploy. Three layers; the `rl:config` Redis hash re-reads every 30 s. `"a Redis override applies with no restart"`. Five malformed-override cases prove a typo cannot remove a limit.
- [x] The webhook path is exempt from public rate limiting. Three tests, including a crafted path that merely contains `webhooks`.
- [x] The Redis-down behaviour is decided, recorded, and covered by a test that simulates the outage. **ADR-050**: fail closed on credential endpoints (`503`, not `429`), open elsewhere. The outage is simulated against a closed port.

**Inherited obligation from `P1-05` — met.** `forgot-password` is limited to 3/hour per (email, IP), with a test.

**Raised**: `OQ-22` — the (email, IP) key gives a distributed attacker a fresh budget per IP; the obvious fix lets a stranger lock a victim out of their own account.

**Left for later tasks**: five policies have no route yet — `P1-09` must apply `invitation-create`, `P1-17` `media-upload`, Phase 2 the public pair, and the two general policies want a global guard rather than a per-route one. Step 7's Prometheus metric is Phase 7; the security event on a block is emitted.

---

## P1-08 — User Profile, Preferences, Account Deletion

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-06 |
| **Spec refs** | `docs/API/02-USER-API.md`, `docs/SECURITY/09-PRIVACY-DATA-PROTECTION.md` § Data Subject Rights, `docs/BACKEND/03-VALIDATION.md` |
| **Spec required** | Yes — data model |
| **Surface** | backend |

**Goal** — Self-scoped profile endpoints that structurally cannot address another user, plus the deletion request the privacy document requires.

**Steps**
1. Implement the six endpoints in `docs/API/02`, all operating on `current_user.id` from the token. `docs/API/02` § Object-Level Authorization makes this an IDOR-prevention-by-design requirement: no endpoint accepts a target `user_id`.
2. Whitelist updatable fields to `full_name` and `phone`. Sending `role`, `email_verified`, `status` or `email` changes nothing, and a test proves it.
3. Validate `phone` against the Indonesian format from `docs/BACKEND/03`, and sanitize `full_name`.
4. Change-password requires the old password and revokes other sessions.
5. Implement account deletion as a soft delete with a confirmation email, and check for the constraint in `docs/DATABASE/01`: `invitations.owner_id` is `ON DELETE RESTRICT`, so a user with live invitations cannot be hard-deleted. Define what happens to their published invitations and record it — deleting an account that is currently serving a wedding invitation is a decision, not an implementation detail (`OQ-11`).
6. Implement notification preference read and update.

**Definition of Done**
- [ ] No user endpoint accepts a user identifier from the client.
- [ ] The mass-assignment test passes for all four forbidden fields.
- [ ] Account deletion soft-deletes, sends confirmation, and has documented behaviour for existing invitations.
- [ ] Changing a password revokes other sessions.

---

## P1-09 — Create an Invitation

| | |
|---|---|
| **Status** | **DONE** 2026-09-12 — [record](../MEMORY/records/2026-09-12-P1-09-create-invitation.md) |
| **Depends on** | P1-06, P0-20 |
| **Spec refs** | `docs/API/04-INVITATION-API.md`, `docs/DATABASE/04-INVITATIONS.md`, `docs/PLAN/02-BUSINESS-RULES.md` § BR-3, `docs/PLAN/10-DOMAIN-PUBLISHING.md` § Subdomain |
| **Spec required** | Yes — data model |
| **Surface** | backend |

**Goal** — `POST /invitations` creates a complete, consistent aggregate: the invitation locked to a specific template version, its settings row, and both people rows.

**Steps**
1. Implement the endpoint per `docs/API/04`, accepting `template_id`, `internal_name` and an optional `slug`.
2. Resolve the template's current **published** version and store both `template_id` and `template_version_id` — BR-3.1 requires the invitation to lock a specific version so an admin's later template update cannot change an already-published invitation's appearance. Storing "latest" is the bug this rule exists to prevent.
3. Reject a template whose version is `draft` or `deprecated` for new invitations (BR-3.3).
4. In one transaction, create: the `invitations` row (status `draft`), the `invitation_settings` row with `enabled_sections` initialized from the template's `enabled_by_default` sections and `seo_indexable = false`, the `invitation_quote` row, and both `invitation_people` rows (groom and bride, empty). Creating the people rows up front means every later PATCH is a simple update rather than an upsert with a race.
5. Validate the slug if supplied, per `docs/PLAN/10`: 3-50 characters, `[a-z0-9-]`, no leading or trailing dash, not on the reserved and profanity blocklist (`docs/SECURITY/10` § Slug Blocklist), globally unique. A conflict returns 409 `SLUG_TAKEN`.
6. Write the initial `invitation_status_history` row through `P0-14`'s service.
7. Enforce the free-draft quota from BR-1.4 (ADR-023): an account may hold at most **one** invitation that has never reached `paid`. A second attempt returns 422 `FREE_DRAFT_LIMIT_REACHED` naming the existing draft. Count only invitations that have never been paid — an organizer with five paid invitations must still be able to start a sixth draft, which is what keeps `docs/UI-UX/03`'s secondary persona viable.
8. Rate limit to 10 per day per user (`docs/SECURITY/10`), mitigating R7 slug squatting. This stays as an abuse backstop even though the free-draft quota makes it hard to reach.

**Definition of Done**
- [x] A created invitation has a settings row, a quote row, and exactly two people rows. The people rows are **empty, not absent**, so every later PATCH is an UPDATE rather than an upsert with a race.
- [x] `template_version_id` points at a concrete published version, never resolved dynamically at read time. And `"a later published version does not move an existing invitation"`.
- [x] A draft or deprecated template version is refused for new invitations. **Mutation**: removing the `status = published` predicate fails both cases.
- [x] Slug validation covers format, blocklist and uniqueness, each with a test. Ten format cases, five blocklist cases (including that an *exact* term does not reject a slug merely containing it, and that leetspeak folding does not apply to reserved words), two uniqueness cases. `409 SLUG_TAKEN` is distinct from the 400s.
- [x] `owner_id` comes from the token and cannot be set from the body. Three spellings rejected at HTTP; the service writes the token's user even when handed another id.
- [x] The free-draft quota is enforced and counts only never-paid invitations, proven by a test where a user with a paid invitation can still create a draft. **A mutation replacing the never-paid predicate with `status = 'draft'` passed every test in the block** — `"a pending_payment invitation STILL counts against the quota"` was added and now catches it.

**Also built here**: `slug_blocklist` (migration `0006`, `docs/DATABASE/12`) and its seed. `P5-13` was to own the table, but a slug validation reading an empty table accepts `admin` and `api`.

**Two real bugs, both caught by tests**: `enabled_sections` was silently empty on every invitation (`section.key` vs `section_key`), and uppercase slugs were being accepted and silently lowercased into an address that would not resolve.

**Abuse cases to test**
| Abuse case | Source | Expectation |
|---|---|---|
| `owner_id` supplied in the body | `docs/SECURITY/05` § 3 | Ignored; owner is the token's user |
| Reserved slug (`admin`, `api`, `www`) | `docs/SECURITY/10` | 400 with a field error |
| Bulk creation to squat slugs | `docs/PLAN/18` R7 | Rate limited at 10/day |

---

## P1-10 — Invitation List, Detail, Update, Soft Delete

| | |
|---|---|
| **Status** | **DONE** 2026-09-12 — [record](../MEMORY/records/2026-09-12-P1-10-invitation-crud.md) |
| **Depends on** | P1-09 |
| **Spec refs** | `docs/API/04-INVITATION-API.md`, `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`, `docs/SECURITY/08` § Mass Data Exposure |
| **Spec required** | Yes — authorization |
| **Surface** | backend |

**Goal** — The four core invitation endpoints, with the owner filter in SQL and an explicit output shape.

**Steps**
1. `GET /invitations` — list the current user's invitations with the owner filter in the query, paginated per `docs/API/00`. `docs/SECURITY/05` § 5 names response-level filtering as the wrong implementation.
2. `GET /invitations/:id` — the full aggregate with every sub-entity embedded, as shown in `docs/API/04` § Example Response.
3. `PATCH /invitations/:id` — partial update of the invitation-level fields only (`internal_name`), with `status`, `owner_id`, `published_at`, `expiry_date`, `template_version_id` all non-writable from the client.
4. `DELETE /invitations/:id` — soft delete: set `deleted_at`, record the status transition, and confirm the partial unique index frees the slug (`docs/DATABASE/04` § Notes).
5. Define explicit response DTOs — no `SELECT *` reaching a response, per `docs/BACKEND/00` and `docs/SECURITY/08` § Mass Data Exposure.
6. Apply the IDOR helper from `P1-06` to all four endpoints.

**Definition of Done**
- [x] The list query filters by owner in SQL; a test with two seeded users proves no leakage. **Mutation**: removing the owner predicate from `findOwnedList` fails `"list: a second user's invitations never appear"`.
- [x] All four endpoints return 404 for another user's invitation. `expectIdorSafe` for detail; explicit tests for update and delete that also assert **nothing changed**; three HTTP tests asserting 404 with no `data`.
- [x] Status cannot be changed through `PATCH`; a test sends `status: "published"` and asserts nothing happened. `published_at` too. **Mutation**: making both the service and the repository spread their argument fails 5 tests — mutating only the repository passes, because the whitelist lives in the service.
- [x] The detail response matches `docs/API/04`'s shape, including nested entities. The key set is asserted **exactly**, so a field added or dropped fails.
- [x] A soft-deleted invitation disappears from the list but its row survives with `deleted_at` set. And its slug is freed (ADR-033), and it is 404 to its own owner.

**Not on this card**: `POST /:id/change-template` and `/upgrade-template-version`, which `docs/API/04` lists beside these four. They are BR-3.2 and BR-4.1 and belong with the template tasks in Phase 2.

---

## P1-11 — Couple Sub-Resource

| | |
|---|---|
| **Status** | **DONE** 2026-09-12 — [record](../MEMORY/records/2026-09-12-P1-11-couple-subresource.md) |
| **Depends on** | P1-10 |
| **Spec refs** | `docs/API/04-INVITATION-API.md` § Couple/Person, `docs/DATABASE/05-EVENTS.md`, `docs/PLAN/08` § Entity: Person |
| **Spec required** | No |
| **Surface** | backend |

**Goal** — `PATCH /invitations/:id/couple/{groom,bride}` updates the pre-created person rows, with photo references validated for tenancy.

**Steps**
1. Implement both endpoints as partial updates over the fields in `docs/PLAN/08` § Person.
2. Validate `photo_media_id` the way `docs/SECURITY/05` § 6 requires: the media must exist, belong to **this** invitation, and be `ready`. Accepting another invitation's media id is a cross-tenant reference even though the endpoint's own `:id` was checked.
3. Sanitize every free-text field through `P1-16` — names render on the public page.
4. Enforce length limits from `docs/DATABASE/05`.

**Definition of Done**
- [x] Both endpoints update the existing row; no duplicate person row can be created. Three concurrent updates leave exactly one row.
- [x] A `photo_media_id` from another invitation is rejected, with a test. **Two** — a different tenant's, and a different invitation of the *same* user's, which is the narrower and more easily missed case. **Mutation**: removing `eq(media.invitationId, invitationId)` fails 3 tests; removing `eq(media.status, "ready")` fails 2 more.
- [x] Script payloads in names do not survive storage. `P1-16`'s pipeline, asserted at the HTTP boundary over all five name fields.
- [x] IDOR tests pass for both endpoints. Each also asserts the target row is unchanged, not only that the call was refused.

**Worth knowing**: all three photo rejections return an identical error, because distinguishing them would be a media-id enumeration oracle. There is no `quarantined` media status — `media_status_check` permits `processing`, `ready`, `failed`, and a test asserting otherwise failed on the constraint.

---

## P1-12 — Events Sub-Resource

| | |
|---|---|
| **Status** | **DONE** 2026-09-12 — [record](../MEMORY/records/2026-09-12-P1-12-events-subresource.md) |
| **Depends on** | P1-10 |
| **Spec refs** | `docs/API/04-INVITATION-API.md` § Events, `docs/DATABASE/05-EVENTS.md`, `docs/BACKEND/03-VALIDATION.md` § Example Schema |
| **Spec required** | No |
| **Surface** | backend |

**Goal** — Full CRUD over N events per invitation, with the child-scoping rule applied to `:event_id`.

**Steps**
1. Implement list, create, update and delete per `docs/API/04`.
2. Validate with the schema in `docs/BACKEND/03`, exactly: type enum, title, date, start time, optional end time, venue, address, optional coordinates with range checks, optional description.
3. Scope `:event_id` by `invitation_id` in the query — `docs/SECURITY/05` § 7's two-step rule, not one.
4. Auto-generate `maps_url` from coordinates when it is empty, at the service layer, per `docs/DATABASE/05` § Notes.
5. Maintain `display_order` so events render in a deliberate order.
6. Sanitize `title`, `address` and `description`.

**Definition of Done**
- [x] An event id belonging to another invitation returns 404 even when the path's invitation is owned by the caller. Two service tests **and** a repository-level test — see the warning below.
- [x] `maps_url` is generated when coordinates are present and it was left empty. Also: never overwrites a link the caller supplied, regenerated when coordinates change, untouched when they do not.
- [x] Out-of-range latitude or longitude is rejected. `z.coerce.number().min().max()`; the coercion is load-bearing, because `"200" > "90"` is false as a string.
- [x] Deleting an invitation cascades its events. Asserted against a hard delete, which is what the constraint governs; the soft-delete case is asserted separately.

**⚠ Read this before `P1-13`, `P1-14`, `P1-15` and Phase 2's gallery.** Both mutations on the two-step rule **passed** at first, because the read and the write were covering for each other: deleting the parent predicate from `findOwnedChild` still produced a 404 (the write refused it), and deleting the owner predicate from `updateEvent` still produced a 404 (the read refused it first). Every service-level test passed while **neither layer was verified**. Five tests now call the repository directly. **Defence in depth makes each layer untestable from the outside — every remaining sub-resource task needs repository-level tests, not only service-level ones.**

**Also found**: `z.string().url()` accepts `javascript:alert(1)` and `data:text/html,...`. `maps_url` becomes an `href`, so the schema requires `^https?://` before parsing. Measured, not assumed.

---

## P1-13 — Bank Accounts and Quote Sub-Resources

| | |
|---|---|
| **Status** | **DONE** 2026-09-12 — [record](../MEMORY/records/2026-09-12-P1-13-gift-accounts-and-quote.md) |
| **Depends on** | P1-10 |
| **Spec refs** | `docs/API/04-INVITATION-API.md`, `docs/DATABASE/06-MEDIA.md` § Data Security Note, `docs/SECURITY/09` § Encryption |
| **Spec required** | Yes — sensitive data |
| **Surface** | backend |

**Goal** — Gift account CRUD and the quote endpoint, with the protections that match what this data actually is: personal data the couple enters **in order to publish it**, so that guests who cannot attend can send a gift. It is not a platform payment credential — nothing in the system moves money with it (`docs/SECURITY/00` § Data Classification, ADR-025).

**Steps**
1. Implement bank account CRUD and `PATCH /invitations/:id/quote`.
2. Scope `:bank_id` by `invitation_id`, as in `P1-12`.
3. Apply the logging rule now, not later: account numbers are masked to the last four digits by the `P0-12` logger, and a test asserts a full number never reaches a log line.
4. Do **not** column-encrypt `account_number` (ADR-025 resolved `OQ-10`). Encryption would protect only the subset that is not already public, in a database that holds names, addresses, coordinates and guest lists in plaintext beside it; storage-level encryption covers the whole store instead.
4b. Build the integrity controls that this field actually needs, because tampering is worse than disclosure here — an attacker who swaps the number on a live invitation collects every guest's gift (R16):
   - record every bank account create, update and delete with actor and timestamp, so "who changed this, and when" is answerable;
   - emit an event on any change to a bank account of a **published** invitation, which `P4-07` turns into a non-optional email to the owner naming what changed — the way a bank confirms a payee change;
   - the ownership check on these endpoints is not routine here: it is the control standing between a compromised account and the guests' money.
5. Validate `type` against the enum, and sanitize `provider_name` and `account_holder`.
6. Maintain `display_order`.

**Definition of Done**
- [x] Account numbers never appear unmasked in any log. Two tests against a real logger with a captured destination — three key spellings including a nested object, plus an assertion that the service's own line contains no digit run of six or more.
- [x] Changing a bank account on a published invitation writes an audit record and emits the owner-notification event, proven by a test. **Mutation**: removing the `status !== "published"` guard fails `"stays quiet on a draft"`, so the guard is doing work rather than the test passing by accident.
- [x] No log line anywhere contains a full account number. As above.
- [x] Cross-invitation `:bank_id` returns 404. Three service tests, each also asserting nothing changed, plus three repository-level tests per the `P1-12` lesson.
- [x] The quote endpoint stores `{text, source}` and sanitizes both.

**The control the card is really about**: the audit callback is a **required argument** of every gift-account write, invoked inside that write's own transaction. `"a FAILING audit rolls the write back"` is what makes "in the same transaction" a fact rather than a claim. Audit rows carry a **masked** number — `docs/DATABASE/10` § Policy asks to avoid duplicating this data, and two years of full account numbers is a worse liability than the one it warns about.

**Deviation**: `audit_logs.admin_id` now holds the acting *user* for owner-sensitive resources (**ADR-053**, `docs/DATABASE/10` amended). A separate history table was rejected — it would split "who changed this gift account" across two places depending on who did it, and an incident asks that question without knowing the answer.

**Delivered on `P1-16`'s promise**: `account_number` is exempt from sanitization and gets a character allowlist instead (`^[0-9][0-9 -]{3,58}[0-9]$`), so markup is unrepresentable. Whitespace is trimmed, not rejected.

---

## P1-14 — Settings Sub-Resource and Slug Rules

| | |
|---|---|
| **Status** | **DONE** 2026-09-12 — [record](../MEMORY/records/2026-09-12-P1-14-settings-and-slug-rules.md) |
| **Depends on** | P1-10 |
| **Spec refs** | `docs/API/04-INVITATION-API.md` § Settings, `docs/DATABASE/04-INVITATIONS.md`, `docs/PLAN/02` § BR-6, `docs/PLAN/07` § Theme Variables |
| **Spec required** | Yes — data model |
| **Surface** | backend |

**Goal** — Section toggles, theme overrides and slug changes, each validated against what the active template actually permits.

**Steps**
1. Implement `GET`/`PATCH /invitations/:id/settings`.
2. Validate `enabled_sections` against the active template version: every entry must be a `section_key` the template defines, and a section with `configurable: false` cannot be disabled (`docs/PLAN/07` § Section System, `docs/FRONTEND/04` step 2).
3. Validate `theme_override` keys against `customizable_theme_keys` — anything outside that list is rejected rather than silently stored, or the customization boundary is not a boundary.
4. Handle the slug per BR-6.2: freely changeable before first publish; after publish, require explicit confirmation and rate limit it, because old links break.
5. Follow the domain-to-table mapping in `docs/PLAN/08` § Where Settings Fields Physically Live (added by ADR-022): `slug` and `expiry_date` are columns on `invitations`, the toggles live on `invitation_settings`, and the API presents both under `/settings`. The service writes to whichever table owns the column, so a user never has to know the schema to change a setting.
6. Handle a slug uniqueness race by catching the unique violation and returning 409, per `docs/BACKEND/06` § Slug Validation.

**Definition of Done**
- [x] A `section_key` the template does not define is rejected. Two tests, one asserting **nothing is stored** — stored-and-ignored is the failure that looks like success.
- [x] A non-configurable section cannot be disabled. 422 `SECTION_NOT_CONFIGURABLE`, with the positive case beside it so it is not passing by refusing everything. A **missing** `configurable` counts as not configurable: `docs/PLAN/07` writes `true` explicitly, and the other default would make a hero switchable off.
- [x] A theme override outside `customizable_theme_keys` is rejected. Keys are compared **exactly** — `colors` does not grant `colors.primary` and vice versa, because a prefix match would widen every template's boundary the first time somebody nested a value.
- [x] Post-publish slug change requires confirmation and is rate limited. Gated on `published_at IS NULL`, **not** `status != 'published'`: unpublishing does not un-share the links people already hold. `slug-change` added to the policy table at 3/day per user, since BR-6.2 asks for a limit and names no number.
- [x] A concurrent slug claim yields 409, not a 500. Postgres `23505` caught by **code**, not by message.

**Beyond the card — `theme_override` *values* are validated, not only its keys.** A theme value becomes a **CSS custom property on the public page**, and unlike a template definition an override comes from an end user: `red; background: url(https://evil.test/?c=…)` would have been a CSS injection reaching every guest. `HEX_COLOR` and `CSS_TOKEN` are imported from `@wi/schema` rather than re-derived, so a user's override is held to exactly what a template definition is held to. Eight injection shapes rejected; removing the check fails **11** tests.

**How it was found**: `check-sanitized-fields` refused `theme_override` as unregistered, and writing the exemption reason forced the question "so what *does* protect this field?" — the keys were checked and the values were `z.unknown()`. That is `P1-16`'s real value: not catching unsanitized prose, but making somebody state what protects each field, where a missing answer becomes visible.

---

## P1-15 — Change Template Without Data Loss

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-10, P0-20 |
| **Spec refs** | `docs/PLAN/02` § BR-3, BR-4.1, `docs/PLAN/07` § Template Compatibility & Migration, `docs/API/04` § change-template |
| **Spec required** | Yes — data model |
| **Surface** | backend |

**Goal** — `POST /invitations/:id/change-template` swaps the presentation layer and touches no invitation data.

**Steps**
1. Implement the endpoint per `docs/API/04`, updating `template_id` and `template_version_id` to the new template's current published version.
2. Recompute `enabled_sections` by intersecting the previous selection with the new template's section keys, then adding the new template's `enabled_by_default` sections that were not previously known. `docs/PLAN/07` § Template Compatibility defines the matching rule as `section_key` equality.
3. Delete nothing. BR-4.1 is explicit: data for sections the new template does not support stays in the database, hidden rather than removed. A test seeds gallery photos, switches to a template without a gallery section, switches back, and asserts every photo is still there.
4. Drop theme overrides that are not customizable in the new template, and say so in the response so the UI can warn (`docs/UI-UX/05` § Change Template Flow lists affected fields in a confirmation modal).
5. Return the list of section keys that will no longer display, for that modal.
6. Record the change in the invitation's history or an update trail so support can answer "why did my gallery disappear".

**Definition of Done**
- [ ] No delete statement runs anywhere in this code path.
- [ ] The round-trip test (template A → B → A) restores full rendering with no data loss.
- [ ] The response names the sections that will stop displaying.
- [ ] Theme overrides invalid under the new template are dropped, not silently kept and ignored.

---

## P1-16 — Free-Text Sanitization Pipeline

| | |
|---|---|
| **Status** | **DONE** 2026-09-12 — [record](../MEMORY/records/2026-09-12-P1-16-sanitization-pipeline.md). **Built out of order**, before `P1-11`: every sub-resource task from `P1-11` to `P1-15` has this as a DoD item, and its own dependency (`P0-13`) was already met |
| **Depends on** | P0-13 |
| **Spec refs** | `docs/SECURITY/08-API-SECURITY.md` § Output Encoding, `docs/BACKEND/03-VALIDATION.md` § Free-Text Input Sanitization, `docs/PLAN/08` § Design Principles |
| **Spec required** | Yes — input handling |
| **Surface** | backend |

**Goal** — One sanitization step, applied after shape validation and before storage, that no free-text field can bypass.

**Why it is its own task** — every free-text field in this product renders on a public page seen by hundreds of guests. `docs/SECURITY/08` calls stored XSS the primary risk here. Implemented per-endpoint, it will be forgotten on the fifth endpoint; implemented as a pipeline stage with a registry of text fields, forgetting requires deleting something.

**Steps**
1. Implement sanitization as an explicit pipeline stage between validation and the service call, per `docs/BACKEND/03`.
2. Use an allowlist sanitizer with a minimal permitted tag set — `docs/SECURITY/08` requires allowlist, never blacklist.
3. Maintain a registry of every free-text path: person names, parent names, child order, event title/venue/address/description, gallery caption, bank provider/holder, quote text and source, RSVP guest name and message, guestbook name and message, invitation internal name, user full name.
4. Add a CI check that a new string field in a request schema is either in the registry or explicitly marked as not user-facing text — so the next endpoint cannot quietly skip it.
5. Keep frontend output encoding as the second layer (`docs/SECURITY/08` — defense in depth), and do not let its existence justify skipping the server step.
6. Test with the payload set that Phase 6's XSS sweep will reuse: script tags, event-handler attributes, `javascript:` URLs, SVG payloads, encoded variants.

**Definition of Done**
- [x] Every field in the registry is sanitized before storage, proven by a parameterized test over all of them. The test iterates `TEXT_FIELDS` itself × 23 payloads, so a field added to the registry is covered without anybody remembering to add a case.
- [x] The CI check fails when a new unregistered text field is added. **Demonstrated**: adding `wedding_hashtag: z.string()` to a controller makes `check-sanitized-fields.mjs` exit 1 naming the file and the field.
- [x] No sanitizer configuration uses a blacklist. `allowedTags: []` for plain text; six tags and **zero attributes** for rich. Two tests assert that an unanticipated tag and attribute are removed without being named anywhere.

**Also enforced**: validate *then* sanitize, with a test — the other order lets a payload change a value's length after the length check.

**Owed by `P1-13`**: a format check for `account_number`, which is exempt from sanitization on the argument that tag stripping would silently alter a value whose exact characters matter.

---

## P1-17 — Media Upload: Synchronous Validation Stage

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-10, P0-16 |
| **Spec refs** | `docs/API/05-MEDIA-API.md`, `docs/SECURITY/06-FILE-UPLOAD-SECURITY.md` layers 1-5, `docs/BACKEND/04-FILE-PROCESSING.md` Stage 1 |
| **Spec required** | Yes — file upload |
| **Surface** | backend |

**Goal** — `POST /invitations/:id/media` accepts a file only after five checks, stores it in isolated staging, and hands off to the worker.

**Steps**
1. Enforce the size limit at the web server and framework level so an oversized body is rejected before it is fully read (`docs/SECURITY/06` layer 4), with the per-package limit from `docs/PLAN/11`.
2. Validate the extension against the allowlist (jpg, jpeg, png, webp).
3. Read the declared `Content-Type` but treat it as advisory only.
4. Read the leading bytes and validate the magic bytes against the claimed format — layer 3, and the check that catches a webshell renamed to `.jpg`.
5. Enforce the per-invitation photo quota from the package before accepting, returning 400 `QUOTA_EXCEEDED` (`docs/API/05` § Error Cases).
6. Store to the isolated staging area from `P0-16`, never to a web-servable path, with a server-generated UUID name — the original filename is never used in a path (`docs/SECURITY/06` layer 8).
7. Create the `media` row with status `processing`, enqueue `media.process`, and respond 201 with `{id, status: "processing", purpose}` per `docs/API/05`.
8. Implement `GET /api/v1/media/:media_id`, ownership-scoped — the endpoint the upload flow polls, added to `docs/API/05` by ADR-021.
9. Return 404, not 403, for another user's invitation or media — `docs/API/05` § Error Cases was corrected by ADR-018.

**Definition of Done**
- [ ] A file whose bytes do not match its extension is rejected before it reaches staging.
- [ ] An oversized upload is rejected without the whole body being buffered.
- [ ] Uploading to another user's invitation returns 404 and creates no row and no file.
- [ ] The stored path contains no attacker-controlled string.
- [ ] `GET /media/:media_id` exists, is ownership-scoped, and `docs/API/05` is amended.

**Abuse cases to test**
| Abuse case | Source | Expectation |
|---|---|---|
| `.php` renamed to `.jpg` | `docs/SECURITY/06` layer 3 | Rejected at magic-byte check |
| Content-Type spoofed to `image/jpeg` | `docs/SECURITY/06` layer 1 | Header not trusted alone |
| Path traversal in the filename | `docs/SECURITY/06` layer 8 | Filename discarded, UUID used |
| Upload to another tenant's invitation | `docs/SECURITY/05` § 6 | 404, nothing stored |
| Quota bypass by parallel uploads | `docs/PLAN/02` § BR-8.1 | Quota enforced under concurrency |

---

## P1-18 — Media Processing Worker

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-17, P0-15 |
| **Spec refs** | `docs/BACKEND/04-FILE-PROCESSING.md` Stage 2, `docs/SECURITY/06` layers 6-11, `docs/ARCHITECTURE/05-STORAGE-ARCHITECTURE.md` |
| **Spec required** | Yes — file upload |
| **Surface** | worker |

**Goal** — The asynchronous half of the pipeline: scan, decode safely, strip EXIF, generate variants, publish to permanent storage.

**Steps**
1. Implement `media.process` following `docs/BACKEND/04` Stage 2 in order: fetch from staging, malware scan, safe decode with memory and time limits, dimension check, EXIF strip, variant generation, upload, database update, staging cleanup.
2. Run the decode with strict limits in the resource-capped worker pool from `P0-15` — this is `docs/SECURITY/06` layer 6, the decompression-bomb defence.
3. Reject extreme dimensions before decoding at full size (layer 5).
4. Strip **all** EXIF, GPS included. `docs/SECURITY/06` layer 7 and `docs/SECURITY/09` both flag GPS in a couple's photos as a home-address leak, which is a privacy incident, not a cosmetic issue.
5. Generate thumbnail, medium and large WebP variants at upload time, not per request (`docs/PLAN/11` § CDN & Delivery).
6. On success set `status = ready` with width, height and size; on failure set `status = failed`, delete the staging file, and log the technical reason while the API returns the generic message from `docs/BACKEND/04` step 9.
7. Make the job idempotent — a retried job checks existing state rather than reprocessing blindly.
8. Add the hourly staging cleanup job for files stranded by a worker crash (`docs/BACKEND/08`).
9. Test with a real EXIF-GPS photo and assert the stored variants contain no EXIF, and with a crafted decompression bomb asserting the worker fails safely without exhausting the host.

**Definition of Done**
- [ ] Stored variants contain no EXIF, verified by reading the output file.
- [ ] A decompression bomb fails the job within the resource limit and never becomes `ready`.
- [ ] A malware-flagged file is deleted and never becomes publicly reachable.
- [ ] The job is idempotent under retry.
- [ ] Stranded staging files older than an hour are cleaned up.

---

## P1-19 — Gallery Sub-Resource, Reorder, Cover, Quota

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-18 |
| **Spec refs** | `docs/API/04-INVITATION-API.md` § Gallery, `docs/DATABASE/06-MEDIA.md`, `docs/PLAN/02` § BR-8.1 |
| **Spec required** | No |
| **Surface** | backend |

**Goal** — Gallery entries link ready media to an invitation, with ordering, a single cover, and quota enforcement.

**Steps**
1. Implement list, attach, update, delete and reorder per `docs/API/04`.
2. On attach, validate that the media exists, belongs to this invitation, and is `ready` — attaching another invitation's media is the exact case in `docs/SECURITY/05` § 6.
3. Enforce a single `is_cover` per invitation; setting a new cover clears the previous one in the same transaction.
4. Enforce the package photo cap (BR-8.1), tested under concurrent attaches.
5. Implement reorder as an atomic bulk update from `ordered_photo_ids`, validating that the set matches exactly the invitation's photos — no foreign ids, none missing.
6. Delete removes the gallery entry and soft-deletes the media; the physical file is removed later by the grace-period job (`docs/PLAN/11` § Deletion).

**Definition of Done**
- [ ] Attaching another invitation's media returns 404.
- [ ] Exactly one cover photo can exist; a test asserts the previous one is cleared.
- [ ] Reorder with a foreign or missing id is rejected wholesale, not applied partially.
- [ ] Quota holds under concurrent requests.

---

## P1-20 — Frontend: Authentication Screens

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P0-22, P1-03 |
| **Spec refs** | `docs/FRONTEND/01-ROUTING.md`, `docs/FRONTEND/02-STATE-MANAGEMENT.md` § Auth Token Storage, `docs/UI-UX/05-USER-FLOWS.md`, `docs/UI-UX/17-ACCESSIBILITY.md` |
| **Spec required** | No |
| **Surface** | web-app |

**Goal** — Register, login, forgot and reset password, email verification landing, and Google sign-in, wired to the real API.

**Steps**
1. Build the five screens with the design system components.
2. Keep the access token in memory and the refresh token in its HTTP-only cookie; the frontend never reads a token from storage (`docs/FRONTEND/02`).
3. Implement the route guard from `docs/FRONTEND/01`: an unauthenticated hit on a protected route redirects to login and preserves the intended URL for post-login return.
4. Preserve template selection across the auth detour, per `docs/UI-UX/11` § "Use This Template": a user who picks a template while logged out lands back in that flow, not on a generic dashboard.
5. Surface the specific error states: invalid credentials, rate limited (429 with a wait hint), unverified email where it matters, expired verification or reset link with a resend action.
6. Meet the accessibility floor from `docs/UI-UX/17`: real labels, `aria-live` error announcements, full keyboard operability.

**Definition of Done**
- [ ] No token is ever written to `localStorage` or `sessionStorage`; a test asserts both are empty after login.
- [ ] Login from a protected URL returns the user to that URL.
- [ ] A template chosen before login survives registration.
- [ ] Every screen passes the automated accessibility check.

---

## P1-21 — Frontend: Dashboard and Creation Wizard

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-20, P1-09 |
| **Spec refs** | `docs/UI-UX/10-COMPONENT-SPECIFICATION.md` § InvitationCard, `docs/PLAN/04` § F2, `docs/UI-UX/04-USER-JOURNEYS.md` (Budi), `docs/UI-UX/15-RESPONSIVE-DESIGN.md` |
| **Spec required** | No |
| **Surface** | web-app |

**Goal** — The multi-invitation dashboard and the three-step creation wizard.

**Steps**
1. Build the invitation list with `InvitationCard` per `docs/UI-UX/10`: thumbnail, internal name, status badge, slug when published, nearest event date, and actions.
2. Implement status filtering — the wedding-organizer journey in `docs/UI-UX/04` depends on distinguishing drafts from published invitations at a glance across many clients.
3. Build the guided empty state from `docs/UI-UX/01` principle 7.
4. Build the wizard from `docs/PLAN/04` § F2: template selection (skipped if arriving from the catalog), internal name and slug with live availability checking, then redirect into the editor.
5. Show slug validation inline, mirroring the server rules, while treating the server as authoritative.
6. Stack the list as cards on mobile rather than a scrolling table (`docs/UI-UX/15`).

**Definition of Done**
- [ ] Status badge colours come from the design system map, not local conditionals.
- [ ] Slug availability is checked before submission and the server result still wins on conflict.
- [ ] The wizard runs once and does not reappear on subsequent edits.
- [ ] The dashboard is usable at 360px width.

---

## P1-22 — Frontend: Editor Shell, Store and Autosave

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-21, P1-10 |
| **Spec refs** | `docs/FRONTEND/06-EDITOR-ARCHITECTURE.md`, `docs/UI-UX/12-EDITOR-UX.md`, `docs/FRONTEND/02-STATE-MANAGEMENT.md`, `docs/UI-UX/09` § Editor Layout |
| **Spec required** | No |
| **Surface** | web-app |

**Goal** — The three-column editor shell with one centralized store and an autosave manager whose status the user can always see and trust.

**Steps**
1. Build the layout from `docs/UI-UX/09` and `docs/UI-UX/12`: 240px section list, centre preview area (a placeholder until `P2-05`), 320px properties panel; tab-switching on mobile.
2. Implement the editor store with the shape in `docs/FRONTEND/02`: `invitationId`, `data`, `templateDefinition`, `activeSectionKey`, `saveStatus`, `dirtyFields`. One store, read by every panel — `docs/FRONTEND/02` § Principles calls duplicated sources of truth the failure mode here.
3. Implement `AutosaveManager`: 1-1.5 second debounce, dispatch a PATCH to the correct sub-resource, update `saveStatus`, and **keep local state on failure** with a retry available. `docs/FRONTEND/06` is explicit that a failed save must not discard the user's work.
4. Render the status indicator from `docs/UI-UX/12`: "Saving…" → "Saved <relative time>" → "Failed to save, try again". `docs/UI-UX/18` makes user confidence in autosave an acceptance criterion, so this indicator is a feature, not a decoration.
5. Implement the multi-tab conflict warning from `docs/FRONTEND/06`: compare the server's `updated_at` and warn non-blockingly rather than overwriting silently.
6. Batch or coalesce rapid changes to the same field so a fast typist produces one request per pause, not one per keystroke.
7. Build the section list with per-section completeness indicators and toggles for configurable sections (`docs/UI-UX/10` § SectionListItem).

**Definition of Done**
- [ ] Editing 100 fields in sequence loses nothing, matching the acceptance criterion in `docs/PLAN/17`.
- [ ] A failed save preserves local state and offers a retry; a test simulates an API failure mid-edit.
- [ ] Save status is visible at all times and never shows "Saved" when a request is in flight or failed.
- [ ] A concurrent edit from a second tab produces a warning, not a silent overwrite.

---

## P1-23 — Frontend: Schema-Driven Properties Panel

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-22, P0-20 |
| **Spec refs** | `docs/FRONTEND/03-FORM-ARCHITECTURE.md`, `docs/PLAN/07` § Required vs Optional Fields, `docs/FRONTEND/00` § Code Conventions |
| **Spec required** | No |
| **Surface** | web-app |

**Goal** — Forms generated from the template schema and the canonical field registry — with no per-template or per-section hard-coding anywhere.

**Steps**
1. Build the `FIELD_REGISTRY` from `docs/FRONTEND/03`, covering every path in `docs/PLAN/08`, importing the path vocabulary from the shared `packages/schema` built in `P0-20` so backend and frontend cannot drift.
2. Render the panel by iterating the active section's `required_fields` and `optional_fields` and resolving each to a field component by registry type.
3. Build the reusable field components from `docs/FRONTEND/03`: text, textarea, date, time, photo, photo-multi, select, map picker, toggle.
4. Mark required fields and show helper text on optional ones (`docs/UI-UX/12` § Properties Panel).
5. Validate inline with a schema aligned to the server's, treating the server as authoritative (`docs/FRONTEND/03` § Validation).
6. Add a CI guard: a grep failing the build if a section key or field path appears as a literal in a component file. `CLAUDE.md`'s "what not to do" list names per-template hard-coding as the thing that defeats the entire template system, and this is the check that keeps it true under deadline pressure.

**Definition of Done**
- [ ] Adding a field to a template's `required_fields` changes the rendered form with no frontend code change — demonstrated in a test using a modified fixture template.
- [ ] No section key or field path is hard-coded in a component; the CI guard proves it.
- [ ] Every registry field type has a component and a unit test.
- [ ] Client validation mirrors the server rules for each field type.

---

## P1-24 — Frontend: Media Manager and Map Picker

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P1-23, P1-19 |
| **Spec refs** | `docs/FRONTEND/05-MEDIA-HANDLING.md`, `docs/PLAN/04` § F4, F5, `docs/UI-UX/17` § Keyboard navigation |
| **Spec required** | No |
| **Surface** | web-app |

**Goal** — Multi-file upload with progress and retry, drag-to-reorder with a keyboard alternative, and a map picker that produces coordinates.

**Steps**
1. Implement the upload flow from `docs/FRONTEND/05`: client-side pre-check for fast feedback, instant local preview, multipart upload with progress, then poll `GET /media/:id` until `ready`, then swap in the CDN URL.
2. Cap concurrency at about three simultaneous uploads so a phone connection is not saturated.
3. Handle failures per file with a retry that does not disturb the rest of the form.
4. Implement drag-to-reorder with a debounced reorder call — and a keyboard alternative (move up/down), which `docs/UI-UX/17` requires explicitly for this interaction.
5. Implement cover selection, caption editing and delete with the brief undo affordance from `docs/FRONTEND/05`.
6. Build the map picker from `docs/PLAN/04` § F5 using **MapLibre GL** over OSM tiles (ADR-014): address input plus a draggable pin producing latitude and longitude, with the backend generating `maps_url`. The public page deliberately loads no map SDK at all — that is `P2-03`'s static image plus deep link.
7. Surface server rejections in plain Indonesian — "file type not supported", "photo quota reached" — never a raw error code.

**Definition of Done**
- [ ] Uploading ten photos at once succeeds with per-file progress and no lost files.
- [ ] Reordering is fully operable by keyboard.
- [ ] A rejected upload shows a specific, human message and leaves other fields untouched.
- [ ] The map picker emits coordinates the events endpoint accepts.

---

## P1-25 — Phase 1 Test Suite and Acceptance

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | all Phase 1 tasks |
| **Spec refs** | `docs/BACKEND/09-TESTING.md`, `docs/TESTING/02-INTEGRATION-TESTING.md`, `docs/PLAN/17-ACCEPTANCE-CRITERIA.md` |
| **Spec required** | No |
| **Surface** | all |

**Goal** — Close the phase against evidence rather than impression.

**Steps**
1. Run the IDOR helper across **every** `:id` endpoint added in this phase and record the result as a matrix of endpoint × method × outcome. `docs/TESTING/04` § IDOR Sweep defines the method; doing it per phase rather than only at Phase 6 is what keeps the finding count near zero at launch.
2. Run the mass-assignment sweep over every write endpoint with `role`, `owner_id`, `status`.
3. Run the file upload abuse set from `P1-17` and `P1-18`.
4. Verify the autosave acceptance criterion from `docs/PLAN/17`: 100 consecutive changes, no data loss.
5. Verify the template-switch criterion: fields disappear and reappear with no loss.
6. Check API p95 latency against the 500ms target on the CRUD endpoints under a modest load.
7. Write the phase summary record from `MEMORY/templates/PHASE-SUMMARY-TEMPLATE.md`.

**Definition of Done**
- [ ] The IDOR matrix is complete with zero failures, and is committed as part of the phase record.
- [ ] Mass-assignment and upload abuse suites pass.
- [ ] The autosave and template-switch acceptance criteria are verified with named tests.
- [ ] Service-layer coverage meets the 80% gate.
- [ ] The phase summary exists in `MEMORY/records/` with its deviations and deferrals named.
