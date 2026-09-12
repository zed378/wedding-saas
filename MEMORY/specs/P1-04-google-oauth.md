# P1-04 — Feature Spec: Google OAuth

| | |
|---|---|
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-04 |
| **Date** | 2026-09-12 |
| **Author** | Claude Code session |
| **Status** | Draft |

---

## 1. Goal

Someone can sign in with Google, and the identity that results comes from a token Google
signed — not from anything the client said about itself.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/01` | Endpoints | `POST /auth/oauth/google { id_token }` |
| `docs/API/01` | Google OAuth | Verify the `id_token` with Google; match or register on the **verified** Google email; `email_verified = true` automatically |
| `docs/SECURITY/03` | Google OAuth | "The `id_token` is verified directly with Google (server-side); NEVER trust the email from the request body" |
| `docs/DATABASE/02` | `users` | `oauth_provider`, `oauth_subject_id`, nullable `password_hash` |
| `TASKS/…` § P1-04 | step 3 | Match on `(oauth_provider, oauth_subject_id)` **first**, then on verified email |

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| — | A Google identity is established only by a signature Google produced | `GoogleTokenVerifier` |
| — | A Google account whose email Google has not verified may not claim an existing local account | `OAuthService.authenticate` |
| — | An OAuth-only account has no password and cannot be logged into with one | `users.password_hash` stays `NULL`; `verifyPassword` handles it (`P1-01`) |

## 4. API Contract

```
POST /api/v1/auth/oauth/google  { id_token }  -> 200 { access_token, user }  + Set-Cookie
```

Identical to `POST /auth/login` in its response and its cookie, because the card's step 6
requires one session model downstream: nothing after authentication should be able to tell
how the session began.

**The request body has exactly one field.** Any `email` a client sends is ignored — not
validated and then ignored, but not read at all, which is the only version of that rule a
future edit cannot quietly weaken.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `users` | Read | By `(oauth_provider, oauth_subject_id)`, then by email |
| `users` | Write | Insert for a new identity; update to link an existing account |
| `user_notification_preferences` | Write | Created with the user, as in `P1-02` |
| `refresh_tokens` | Write | Same session as password login |

**Migration required: yes — one unique index.** See § 14; this answers `OQ-15`.

## 6. Authorization

Unauthenticated. Authorisation *is* the token verification.

Three checks, all of which Google's library performs and none of which may be skipped:

| Check | Why it is not optional |
|---|---|
| Signature, against Google's published keys | Without it the token is a JSON object anybody can write |
| `aud` equals our client id | A token minted for **another** application is validly signed by Google. Accepting it lets any site that uses Google Sign-In mint sessions here |
| `exp` | An old token captured from a log or a proxy would work forever |

`iss` is checked too (`accounts.google.com` or `https://accounts.google.com`).

## 7. Validation and Sanitization

| Field | Rule |
|---|---|
| `id_token` | A non-empty string, length-bounded. Everything else is Google's to decide |
| `email` (from the token) | Lowercased, as everywhere else |
| `name` (from the token) | Sanitized and truncated to 100 characters, the column width. Absent is allowed — a Google account need not expose a name — and falls back to the local part of the address |

## 8. State Transitions

`users.email_verified`: `false -> true` when a local account is linked to a Google identity
whose email Google reports as verified. That is the one place this endpoint may flip it,
and `docs/API/01` § Google OAuth is explicit that it should.

## 9. Side Effects

None. No email is sent: a Google sign-in needs no verification link, and telling the owner
of a local account that it was linked is a notification `P4-06` can add once there is a
provider. **Recorded as a follow-up, not silently dropped** — account linking is exactly
the event a user should hear about.

## 10. Failure Modes

| Failure | Behaviour |
|---|---|
| Malformed, expired, or wrongly-signed `id_token` | `401 INVALID_CREDENTIALS`. One error for all three |
| `aud` is another application's client id | `401`, same error |
| Google's keys cannot be fetched | `503`. **Not** a 401: the user did nothing wrong, and a 401 would make them retype a password they may not have |
| Google reports `email_verified: false` and a local account exists | `403`. Refusing to link is the only safe answer — see § 11 |
| Google reports `email_verified: false` and no account exists | `403`. Registering would create an account on an address nobody proved they own |
| The account is suspended | `403`, as with password login |

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| A hand-written `id_token` | `docs/SECURITY/03` | Rejected; nothing is created | "an unsigned token creates no account" |
| A token minted for a different Google client | `docs/SECURITY/03` | Rejected on `aud` | "a token for another audience is refused" |
| An expired token | — | Rejected | "an expired token is refused" |
| **An `email` in the request body different from the token's** | `docs/SECURITY/03`, DoD 2 | The body has no effect whatsoever | "the email in the request body has no influence on the identity" |
| **Account takeover via an unverified Google email** | — | Refused | "an unverified Google email cannot claim an existing account" |
| Password login against an OAuth-only account | DoD 3 | The generic `INVALID_CREDENTIALS`, and no crash on the null hash | "an OAuth-only account cannot be used for password login" |
| Two accounts converging on one Google subject | `OQ-15` | Impossible — unique index | "one Google identity cannot attach to two accounts" |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit — verifier | the three checks, each failing independently, against a fake issuer |
| Integration | new identity registers; returning identity matches on subject; a local account links when the Google email is verified; refuses to link when it is not; suspended refused; the body email is inert; the session is the same shape as password login |
| Mutation | drop the `audience` option from the verifier and confirm "a token for another audience is refused" fails; accept `email_verified: false` and confirm the linking test fails |

## 13. Observability

- `auth.oauth_login` at `info` with the user id and whether the account was created,
  matched or linked. Never the `id_token`, which is a bearer credential.
- A refused link on an unverified Google email is a security event: it is what an account
  takeover attempt looks like.

## 14. Open Questions

- **`OQ-15` — should a Google identity be unique across accounts? — this task answers it:
  yes.** The backlog entry deferred the decision until "the linking behaviour is actually
  designed", and the card's step 3 designs it: *"Match on `(oauth_provider,
  oauth_subject_id)` first"*. That makes the subject id a **login key**, and OQ-15's own
  reasoning then applies — "a duplicate makes login ambiguous". A unique partial index is
  added, over active rows only, matching how `idx_users_email` treats soft deletes.
  Recorded as an ADR and reported, not decided in passing.
- **Nobody is told their account was linked.** `P4-06` owns email delivery. Linking is
  precisely the event a user should hear about, so it is a follow-up rather than an
  omission.
- **`GOOGLE_OAUTH_CLIENT_ID` is required only when the feature is used.** Optional in the
  schema; the service refuses to start a verification without it, with a message naming
  the variable. Making it required outright would stop every developer who is not working
  on OAuth from booting the API.
