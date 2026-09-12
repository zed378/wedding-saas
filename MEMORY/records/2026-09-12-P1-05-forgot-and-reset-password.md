# P1-05 — Forgot and reset password

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-05 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-05-password-reset` |
| **Status** | Completed |
| **Spec** | [`MEMORY/specs/P1-05-forgot-and-reset-password.md`](../specs/P1-05-forgot-and-reset-password.md) |

---

## What Changed

`POST /auth/forgot-password` and `POST /auth/reset-password`. A one-hour, single-use,
hashed token; a new password that must satisfy `P1-01`'s policy; and **every session on
the account revoked in the same transaction as the password write**.

## Why

`docs/SECURITY/03` § Password Reset, and specifically its parenthetical: sessions are
invalidated *"in case the account was already compromised previously"*. That sentence is
the whole design. Most resets are somebody who forgot; the ones that matter are somebody
taking their account back from a person holding a thirty-day refresh token, and if the
sessions survive the reset, pressing the button achieves nothing.

## How

**The revocation is in the same transaction as the password write.** A crash between them
would leave a changed password and the attacker's session both working — exactly the state
the requirement exists to prevent, and one nobody would notice, because the user would see
their new password working fine.

**Every other live reset token dies too.** Two links in two emails, one of which the
attacker requested, is not a state to leave behind.

**The unknown-address path still touches the database.** The DoD asks for known and unknown
to be indistinguishable "in both body and timing". Returning early would have cost one
`SELECT` against a `SELECT` plus a two-statement transaction. `equivalentWork()` runs the
same transaction against the nil UUID, matching nothing. This is **weaker than `P1-01`'s
dummy-hash trick**, which achieves real cost equality because there is a 277 ms hash to
mirror; here there is nothing expensive, so the honest claim is "the same statements, so
the same order of magnitude", and the test asserts that rather than equality.

**A rejected password still spends the token.** Deliberate: leaving it live until a valid
password arrived would make one link usable repeatedly by whoever holds it.

**An OAuth-only account can set a password through this flow.** They own the address, and
"set a password" is a reasonable thing to want. Refusing would also make such an account
distinguishable from an unknown one by whether an email arrives — enumeration through a
side channel.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/auth/password-reset.service.ts` | **New** |
| `backend/api/src/modules/auth/auth.controller.ts` | Two endpoints |
| `backend/api/src/modules/auth/auth.module.ts` | Provider |
| `backend/api/test/integration/password-reset.itest.ts` | **New** — 29 tests |

No migration. `user_tokens` already carries `password_reset` and `TOKEN_LIFETIME_MS`
already had the one-hour figure, both from `P1-02`.

## Decisions Made

| Decision | Rationale |
|---|---|
| Revocation inside the password-write transaction | A crash between them leaves the exact state the control exists to prevent |
| Other live reset tokens are spent too | One live link per account, as with verification |
| `invalid` and `already_used` are one answer | "Already used" confirms the token was once real — information about somebody else's account |
| A rejected new password still spends the token | Otherwise one link is reusable by whoever holds it |
| A suspended account is treated as unknown on request | A reset would not help, and saying so confirms the address exists |
| An OAuth-only account gets a link | They own the address; refusing is also a side channel |
| Rate limiting is **not** implemented here | `P1-07` owns it; a bespoke limiter would be a second implementation. Not a DoD item on this card — see below |

## Deviations from `docs/`

None.

## Tests Added

29 integration. API integration total 276 → 305.

| Group | Cases |
|---|---|
| Asking | a link for a known address; **unknown indistinguishable in body**; **and in timing**; nothing sent for unknown or suspended; any case accepted; **no token row written for an unknown address** |
| The token | stored only as a 64-hex hash; **one hour, not 24**; asking twice leaves only the newer link live |
| Redeeming | sets the password; the old one stops working; **single use**; unknown refused; expired refused; **a verification token is not a reset token**; **the token determines whose password changes**; the policy applies; a rejected password still spends the token; a suspended account is refused |
| **Sessions** | **a pre-reset refresh token stops working**; **every device, not just the one that asked**; a failed reset leaves sessions alone; other users are untouched |
| The owner is told | a change sends `password_changed`; a failed reset sends nothing; **the notification carries neither the password nor the token** |
| No-password accounts | an OAuth-only account can set a password and then log in with it |
| `isRedeemable` | live yes; spent, unknown and expired all no |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| A reset ends every session | `docs/SECURITY/03` § Password Reset | "a pre-reset refresh token stops working" and "every device, not just the one that asked". **Mutation**: deleting the revocation `UPDATE` fails both |
| Reset tokens are hashed, 1 hour, single use | `docs/SECURITY/03` | "is stored only as a hash", "a reset token expires in an hour", "a used reset token cannot be redeemed twice" |
| Requesting a reset does not reveal whether an address exists | `docs/SECURITY/03` | "an unknown address is indistinguishable from a known one" (body), "an unknown address costs about as much as a known one" (timing), "writes no token row for an unknown address" |
| One user cannot reset another's password | — | "the token determines whose password changes" — there is no user id in the request; the test asserts the other account's hash is byte-identical afterwards |
| Tokens are not interchangeable between purposes | — | "an email-verification token is not a reset token" |
| The new password meets the policy | `P1-01` | "the policy applies to the new password" |
| No password or token reaches a log or a job payload | `docs/DEVOPS/06` | "the notification carries no password and no token" |

## Abuse Cases Covered

Every row of the spec's § 11 table has a named test.

## DoD Verification

- [x] Reset tokens are hashed, expire in an hour, and are single-use. Three tests.
- [x] All sessions are revoked on reset, proven by a test that a pre-reset refresh token stops working. Plus the mutation that makes it fail.
- [x] Requesting a reset for an unknown email is indistinguishable from a known one, in both body and timing. Two tests; the timing claim is bounded, not absolute, and the service comments say why.

**Step 4 (rate limit 3/hour per email+IP) is not implemented and is not a DoD item on this
card.** It is recorded as an obligation on `P1-07`, which owns rate limiting — the same
arrangement `P1-02` used for the publish/checkout gate.

## What Did Not Work

**1. A test read the wrong row and asserted 24 hours against a one-hour rule.**
`"a reset token expires in an hour"` failed with a 23-hour discrepancy: `select().from(userTokens)`
with no filter returned the **email-verification** token that registration had left in the
same table. The fix is a `where(eq(userTokens.type, "password_reset"))` helper, and the
lesson is that `user_tokens` is shared between two features — an unfiltered read of it is
almost always a bug. The neighbouring "is stored only as a hash" test had the same defect
and passed anyway, because both rows are 64 hex characters.

**2. The first attempt at timing equalisation could not work.** `equivalentWork` was
originally `issueToken(db, NO_USER, …)`, which is an `INSERT` against a foreign key — a nil
UUID raises `23503` rather than costing a round trip. Replaced with two `UPDATE`s that
match nothing, which is the same two statements in the same transaction without the
constraint.

## Follow-Ups and Open Questions

- **`P1-07` must rate limit `forgot-password` to 3/hour per (email, IP)** and test it.
  That is this card's step 4, deliberately deferred to the task that owns the mechanism.
- **Email delivery is still a stub** (`P4-06`). Both jobs are enqueued and the worker logs
  them, so a real user cannot yet click a real link. The token and the flow are real and
  tested through the queue payload.
- **`isRedeemable` has no caller yet.** `P1-20` needs it for "is this link still good?"
  before rendering a password form.

## What to Watch

**`sessions_revoked` on `auth.password_reset_completed`.** A reset that revokes several
sessions is materially different from one that revokes none — the first is plausibly a user
kicking an intruder out. It is the cheapest available signal for an account takeover that
nobody reported.

**The timing defence is bounded, not absolute.** If database latency grows, so does the
absolute difference between the two paths. The test asserts the same order of magnitude and
will not catch a slow drift into distinguishability.
