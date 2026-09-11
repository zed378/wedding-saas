# P1-02 — Feature Spec: Registration and Email Verification

| | |
|---|---|
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-02 |
| **Date** | 2026-09-11 |
| **Author** | Claude Code session |
| **Status** | Draft |

---

## 1. Goal

Someone can create an account. They get a verification email they did not wait for, they can start drafting an invitation immediately, and they cannot publish or pay until they have clicked the link.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/01` | Registration Flow | `POST /auth/register`, `/auth/verify-email`, `/auth/resend-verification` |
| `docs/API/01` | step 2 | Unverified users may draft; publish and checkout are refused |
| `docs/SECURITY/03` | Email Verification | "Verification token: random, 24-hour expiry, single-use" |
| `docs/SECURITY/03` | Login Rate Limiting | The enumeration principle: a response must not reveal whether an email is registered |
| `docs/DATABASE/02` | Single-Use Token Table | `user_tokens`: hashed token, `type`, `expires_at`, `used_at` (ADR-020) |
| `docs/BACKEND/07` | — | Notifications go through the worker; the request does not wait |
| `docs/PLAN/01` | FR-1.1 | Registration with email and password |
| `docs/API/00` | Envelope, status codes | `201` on create; `403 EMAIL_NOT_VERIFIED` for the gate |

**No contradictions found.**

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| — | An unverified user may create and edit drafts | By absence: nothing blocks it |
| — | An unverified user may not publish or check out | The **publish and order services**, per step 5 — not a middleware |

## 4. API Contract

Exactly `docs/API/01`:

```
POST /api/v1/auth/register             { email, password, full_name }   -> 201
POST /api/v1/auth/verify-email         { token }                        -> 200
POST /api/v1/auth/resend-verification  { email }                        -> 200
```

**`register` returns the same response whether or not the email is already registered.** `201` with a body that says a verification email has been sent. That is the enumeration defence and it is the DoD's fourth item; the alternative — `409 EMAIL_EXISTS` — turns the endpoint into an oracle for "does this person have an account", which for a wedding service leaks something socially sensitive.

An existing address still gets an email: *"someone tried to register with your address; you already have an account"*. Without it, the real owner sees nothing while an attacker learns nothing — but the owner also loses the one signal that someone is probing their account.

`resend-verification` is likewise uniform: `200` regardless.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `users` | Write | `email_verified = false`, `password_hash` from `P1-01` |
| `user_tokens` | Write, then Update | `type = 'email_verification'`, hashed, 24h |
| `user_notification_preferences` | Write | Created at registration, per step 6 |

**Migration required: no.** Every table exists from `P0-07`.

All three writes happen in **one transaction**. A user without their preferences row is a row every later query has to defend against; creating it here means no later code handles its absence.

## 6. Authorization

All three endpoints are **unauthenticated** — they are how you get an account.

- `verify-email` authorises by possession of the token and nothing else. It takes no user id: deriving the user from the token is what stops one user verifying another's address.
- `resend-verification` takes an email and reveals nothing about it.

## 7. Validation and Sanitization

| Field | Rule |
|---|---|
| `email` | Valid address, ≤ 255 (`docs/DATABASE/02`), lowercased for storage and comparison |
| `password` | `checkPasswordPolicy` from `P1-01`, **with email and full_name passed as context** — that context is what activates the identity-resemblance rule |
| `full_name` | 1–100 characters, sanitized before storage (`docs/SECURITY/08`) |

Email is lowercased because `Budi@Gmail.com` and `budi@gmail.com` are the same mailbox, and a case-sensitive unique index would let both exist.

## 8. State Transitions

`users.email_verified`: `false → true`, once, on redemption. Not an invitation status, so no `invitation_status_history` row. The `user_tokens.used_at` write **is** the record that it happened.

## 9. Side Effects

| Effect | When | Why there |
|---|---|---|
| `notification.send` job enqueued | **After** the transaction commits | A job emitted before commit can describe a user that never existed — the worker would look up a row that was rolled back |
| Verification email | By the worker | Registration must not block on a third party |

## 10. Failure Modes

| Failure | Behaviour |
|---|---|
| Email provider down | Registration **succeeds**. The job retries per `P0-15`'s policy. DoD item 2 |
| Redis down, so the job cannot be enqueued | Registration still succeeds; the failure is logged as a security-adjacent event. A user who exists without a verification email can use `resend-verification`; a registration rolled back because Redis blinked is a worse outcome |
| Token already used | `200`, idempotent no-op. The user clicked twice, or a mail client prefetched the link |
| Token expired | `400 TOKEN_EXPIRED`, with the resend path in the message |
| A second registration for the same address | `201`, same body. See § 4 |

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Enumerate accounts through the register response | `docs/SECURITY/03` | Identical status, body and shape | "does not reveal that an email is already registered" |
| Enumerate through resend-verification | same | Identical response | "resend reveals nothing about an unknown address" |
| Replay a verification link | `docs/SECURITY/03` | Second use is a no-op, not an error and not a re-verification | "a used token cannot be redeemed twice" |
| Guess a token | — | 256 bits of entropy; only the hash is stored | "only a hash of the token is stored" |
| Verify someone else's address | — | The user comes from the token, never from the request | "the token determines the user" |
| Use an expired token | `docs/SECURITY/03` | Rejected | "an expired token is refused" |
| Publish or pay while unverified | `docs/API/01` step 2 | `403 EMAIL_NOT_VERIFIED` | Deferred — see § 14 |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit — tokens | generated tokens differ; only the hash is stored; the hash is not reversible; expiry respected; single use enforced |
| Integration | the whole registration transaction; preferences row created; duplicate address; verify; replay; expired; resend for known and unknown addresses |
| Security | the abuse-case table |
| Mutation | make `used_at` set outside the transaction and confirm the replay test fails; return `409` for a duplicate and confirm the enumeration test fails |

## 13. Observability

- `auth.registration` at `info` with the user id, never the email beside it.
- A failure to enqueue is a `warn` with the reason.
- No password, no token, no hash is logged. **Correction to this spec as drafted**: it claimed `token` was missing from `REDACTED_KEY_NAMES` and had to be added. It was already there, along with `tokenhash` — `P0-12` made the set "deliberately wider than the list" in `docs/DEVOPS/06`. Checked rather than assumed; nothing needed adding.

## 14. Open Questions

- **The publish and order gate cannot be tested here.** `POST /publish` is `P3-06` and `POST /orders` is `P3-01`; neither exists. DoD item 3 asks for tests on both. The gate is implemented as a reusable guard with its own unit tests, and the two endpoint tests are recorded as an obligation on those cards rather than claimed here.
- **Email delivery is not implemented.** `P4-06` owns the provider. The job is enqueued and the worker handler is a stub that logs. That is the honest state and the DoD only requires that registration not block on it.
