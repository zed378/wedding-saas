# P1-05 — Feature Spec: Forgot and Reset Password

| | |
|---|---|
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-05 |
| **Date** | 2026-09-12 |
| **Author** | Claude Code session |
| **Status** | Draft |

---

## 1. Goal

Someone who has forgotten their password can set a new one, and doing so ends every
session on the account — because the most likely reason a reset is happening at all is
that somebody else is in there.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/01` | Endpoints | `POST /auth/forgot-password { email }`, `POST /auth/reset-password { token, new_password }` |
| `docs/SECURITY/03` | Password Reset | "random, 1-hour expiry, single-use, invalidates all active sessions/refresh tokens after a successful reset (mitigation in case the account was already compromised previously)" |
| `docs/SECURITY/03` | Login Rate Limiting | The enumeration principle |
| `docs/SECURITY/10` | — | 3 per hour per (email, IP) |
| `docs/DATABASE/02` | `user_tokens` | `type = 'password_reset'`, hashed, `used_at` |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| — | A reset ends every session, including the attacker's | `revokeAllForUser`, in the same transaction as the password write |
| — | A reset token is usable once | `consumeToken` from `P1-02` |
| — | The new password must satisfy the policy | `checkPasswordPolicy` from `P1-01` |

## 4. API Contract

```
POST /api/v1/auth/forgot-password  { email }                  -> 200 { message }
POST /api/v1/auth/reset-password   { token, new_password }    -> 200 { message }
```

Both uniform. `forgot-password` says the same thing for a known address, an unknown one,
and an OAuth-only account with no password at all.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `user_tokens` | Write, Update | `type = 'password_reset'`, 1 hour (`TOKEN_LIFETIME_MS` already has it) |
| `users` | Write | `password_hash` |
| `refresh_tokens` | Update | Every live one revoked |

**Migration required: no.**

## 6. Authorization

Both endpoints are unauthenticated. `reset-password` authorises by possession of the
token, and takes no user id — deriving the user from the token is what stops one person
resetting another's password.

## 7. Validation and Sanitization

| Field | Rule |
|---|---|
| `email` | Valid address, at most 255, lowercased |
| `token` | Non-empty, bounded |
| `new_password` | `checkPasswordPolicy`, **with the account's email and name as context** so the identity-resemblance rule is live |

## 8. State Transitions

`user_tokens.used_at`: `NULL -> timestamp`, once. `refresh_tokens.revoked_at` for every
live row of that user. Both in **one transaction** with the `password_hash` write, so a
crash cannot leave a changed password with live old sessions — which is the exact state
the requirement exists to prevent.

## 9. Side Effects

| Effect | When | Why there |
|---|---|---|
| `notification.send` — the reset link | On request, for a known address with a password | The only channel |
| `notification.send` — "your password was changed" | After a successful reset | Step 5. An unauthorised reset has to be visible to the real owner, who is the only person who can say it was not them |
| `auth.login_failed` security event | A reset attempt on an unknown or invalid token | Feeds `P1-07` |

## 10. Failure Modes

| Failure | Behaviour |
|---|---|
| Unknown email | `200`, identical body. No email sent |
| OAuth-only account (no password) | `200`, identical body. **A reset link is still sent** — see below |
| Expired token | `400 TOKEN_EXPIRED` |
| Used token | `400`, same as invalid. A replay must not confirm the token was ever real |
| Weak new password | `400 VALIDATION_ERROR`, naming the rule |
| Suspended account | `200` on request, and the reset itself refuses with `403` |

**Why an OAuth-only account still gets a reset link.** They have no password, but they do
own the address, and "set a password" is a reasonable thing for them to want. Refusing —
or silently doing nothing — would also make the account distinguishable from an unknown
address by whether an email arrives, which is enumeration through a side channel.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Enumerate accounts through forgot-password | `docs/SECURITY/03` | Identical body | "an unknown address is indistinguishable from a known one" |
| Enumerate through timing | DoD 3 | Comparable duration | "an unknown address costs about as much as a known one" |
| Reset with a token that was already used | `docs/SECURITY/03` | Refused, and indistinguishable from a token that never existed | "a used reset token cannot be redeemed twice" |
| **Keep a session after the victim resets** | `docs/SECURITY/03` | Every refresh token revoked | "a pre-reset refresh token stops working" |
| Use a verification token as a reset token | — | Refused | "an email-verification token is not a reset token" |
| Reset someone else's password | — | No user id in the request | "the token determines whose password changes" |
| Reset to a breached or trivial password | `P1-01` | Refused by the policy | "the policy applies to the new password" |
| Hold a reset link for weeks | `docs/SECURITY/03` | One hour | "a reset token expires in an hour" |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Integration | the whole flow; uniform responses; expiry; single use; type separation; **session revocation**; the notification on change; policy enforcement; OAuth-only account gains a password |
| Mutation | move `revokeAllForUser` outside the transaction and confirm nothing fails (it should not — order is what matters); **delete the call entirely** and confirm "a pre-reset refresh token stops working" fails |

## 13. Observability

- `auth.password_reset_requested` and `auth.password_reset_completed` at `info`, with the
  user id. Never the address beside it, and never the token.
- A reset that revokes sessions logs how many, because that number is the difference
  between "a user forgot their password" and "a user just kicked somebody out".

## 14. Open Questions

- **Step 4 (rate limiting, 3/hour per email+IP) is not implemented here.** `P1-07` owns
  rate limiting and lands two tasks later; a bespoke limiter here would be a second
  implementation to keep in step, and `docs/SECURITY/10` describes one mechanism, not
  several. It is **not** a DoD item on this card. Recorded as an obligation on `P1-07`,
  which must limit `forgot-password` specifically and test it — the same arrangement
  `P1-02` used for the publish/checkout gate.
- **Email delivery is still a stub** (`P4-06`). Both jobs are enqueued and the worker logs
  them. The reset link therefore cannot actually be clicked by a user yet; the token is
  real and the flow is tested end to end through the queue payload.
