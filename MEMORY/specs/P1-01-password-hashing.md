# P1-01 — Feature Spec: Password Hashing and Password Policy

| | |
|---|---|
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-01 |
| **Date** | 2026-09-11 |
| **Author** | Claude Code session |
| **Status** | Draft |

---

## 1. Goal

A password can be hashed and verified, and a bad password can be rejected, with three properties that are cheap now and expensive to retrofit: the hash is argon2id with parameters **measured on the deployment host** rather than copied from a blog post; verification takes the same time whether or not the account exists; and no plaintext password can reach a log or a column.

Nothing calls this yet. `P1-02` (registration) and `P1-03` (login) are its first consumers, and the reason it is a task of its own is that both of them are easier to get wrong than to write.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/SECURITY/03` | Password | argon2id recommended (bcrypt cost ≥ 12 the fallback); minimum 8 characters; **no restrictive maximum**, so passphrases work; a breached-password check via the HIBP k-anonymity API is *recommended* |
| `docs/SECURITY/03` | Login Rate Limiting | "Generic login error message … does not distinguish an unregistered email from a wrong password (prevents user enumeration)" |
| `docs/SECURITY/03` | Logging & Monitoring | Consecutive failed logins are security events |
| `docs/DATABASE/02` | Notes | "`password_hash` uses the bcrypt/argon2 algorithm — never stored/logged in plaintext" |
| `docs/API/01` | Errors | `401 INVALID_CREDENTIALS`, generic, for both causes |
| `docs/API/00` | Envelope | `400`/`422` with `details[]` of `{ field, message }` for a policy violation |
| `docs/DEVOPS/06` | Mandatory Redaction | `password` is already in `REDACTED_KEY_NAMES` (`P0-12`, now `@wi/logging`) |

**No contradictions found.** One thing the documents leave open, which `P1-01` step 4 explicitly asks to decide: what happens when the breached-password API is unreachable. That is § 10 and becomes an ADR.

## 3. Business Rules Implemented

None from `docs/PLAN/02` — this is a security control, not a business rule. The nearest thing is `docs/SECURITY/03` § Password, treated here with the same weight.

## 4. API Contract

**This task adds no endpoint.** It provides the service `P1-02` and `P1-03` call:

```ts
hashPassword(plain: string): Promise<string>          // argon2id encoded hash
verifyPassword(hash: string | null, plain: string): Promise<boolean>
checkPasswordPolicy(plain: string, context?): Promise<PolicyViolation[]>
```

`verifyPassword` accepts `null` deliberately. A Google account has no password (`users.password_hash` is nullable, `P0-07`), and the call site that forgets to handle that is the one that logs someone in without a credential. Passing `null` must do the same work and return `false`.

Violations map to `docs/API/00`'s `details[]`:

```json
{ "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "…",
             "details": [ { "field": "password", "message": "Kata sandi minimal 8 karakter." } ] } }
```

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `users.password_hash` | neither, directly | `varchar(255)`, nullable. This task produces the value; `P1-02` writes it |

**Migration required: no.** An argon2id encoded hash is ~95–100 characters at these parameters; 255 is ample, and that was checked rather than assumed.

## 6. Authorization

No endpoint, so no object-level authorization. Two properties that are authorization-adjacent:

- **`verifyPassword` is the only comparison.** No call site may compare hashes itself, and nothing returns the hash.
- **A `null` hash never verifies.** An OAuth-only account cannot be logged into with a password, and `verifyPassword(null, anything)` returns `false` after doing the full work.

## 7. Validation and Sanitization

The policy, in the order a user meets it:

| Rule | Source | Behaviour |
|---|---|---|
| Minimum 8 characters | `docs/SECURITY/03` | Rejected with a field error |
| **No maximum below 128** | `docs/SECURITY/03` ("allow long passphrases") | A 100-character passphrase is accepted |
| An absolute cap of 128 | — | Not a policy rule but a denial-of-service bound: argon2 cost is independent of input length, but hashing a 10 MB "password" still copies 10 MB. `docs/SECURITY/03` forbids an *overly strict* maximum, and 128 is not one |
| Not a breached password | `docs/SECURITY/03` (recommended) | HIBP k-anonymity. Failure mode in § 10 |
| Not trivially related to the email or name | — | Rejected. Cheap, and the commonest weak password is the user's own name |

Passwords are **never trimmed, normalised or case-folded**. A leading space is part of the password; silently removing it means a password that works at registration and fails at login.

## 8. State Transitions

None.

## 9. Side Effects

- A **security log event** when the breached-password check cannot run (§ 10), via `logSecurityEvent` from `@wi/logging`.
- No email, no queue, no cache.

The HIBP call is the only outbound network request. It sends the **first five characters of the SHA-1 hash** and nothing else — that is what k-anonymity means, and it is worth stating because "we send your password to a third party" is the reasonable fear this design exists to avoid.

## 10. Failure Modes

**The decision `P1-01` step 4 demands.**

| Failure | Behaviour | Why |
|---|---|---|
| HIBP unreachable, times out, or returns a non-200 | **Fail open** — accept the password, emit a security event and a counter | `docs/SECURITY/03` calls this check "recommended", not required. Failing closed would block a couple from registering during someone else's outage, and the primary controls — minimum length, the similarity check, and `P1-07`'s rate limiting — still hold. Failing open *silently* would be the wrong half of this trade, which is why the event is not optional |
| HIBP returns malformed data | Treated as unreachable | Parsing hopefully is how a "not breached" answer gets invented |
| argon2 throws | Propagate. Registration fails with a 500 | A hash that did not happen must never be treated as a hash that did |
| `verifyPassword` gets a malformed or truncated hash | `false`, after the same work | A corrupt column must not become an authentication bypass |

The timeout is short (2s) and the check runs **concurrently** with nothing — it is on the registration path, and a slow third party must not make registration feel broken.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Enumerate accounts by timing the login response | `docs/SECURITY/03` § Login Rate Limiting | Unknown-user and wrong-password paths take indistinguishable time | "does comparable work for an unknown user as for a wrong password" |
| Log in to a Google-only account with a password | `docs/SECURITY/03` § Google OAuth | `false`, and the same work is done | "a null hash never verifies" |
| Register with `password` or `12345678` | `docs/SECURITY/03` § Password | Rejected, field error | "rejects a known-breached password" |
| Register with the user's own email as the password | — | Rejected | "rejects a password that is the email's local part" |
| A password long enough to exhaust memory | — | Rejected above 128 characters | "rejects an absurdly long password" |
| A plaintext password reaches a log | `docs/DEVOPS/06`, `docs/DATABASE/02` | Redacted by the formatter | "the plaintext never appears in a log line" |
| HIBP is down and nobody notices | `P1-01` step 4 | A security event is emitted | "emits a security event when the breach check cannot run" |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit — hashing | round-trips; wrong password fails; the encoded hash is **argon2id** and carries the configured parameters; two hashes of the same password differ (salted); the hash fits `varchar(255)` |
| Unit — verification | `null` hash; empty hash; truncated hash; a bcrypt hash (the documented fallback, so it must not crash); correct and incorrect |
| Unit — policy | under 8 rejected; exactly 8 accepted; a 100-character passphrase accepted; 129 rejected; leading/trailing space preserved; email local part rejected; name rejected |
| Unit — breach check | a known-breached password rejected; an unbreached one accepted; **only the SHA-1 prefix leaves the process**; unreachable → accepted **and** a security event; non-200 → same; malformed body → same; the plaintext never appears in the outbound request |
| Unit — timing | unknown-user and wrong-password paths measured over many iterations, asserted within a tolerance |
| Security | the abuse-case table, one test each |
| Mutation | remove the dummy-hash verification, and remove the `null` guard; each must fail a named test |

**Measured, and the second prediction was wrong.** Removing the dummy-hash verification fails both timing tests. Removing the `null` guard entirely **also** fails both timing tests — and *not* "a null hash never verifies", which passes either way: with the guard gone, `argon2.verify(null, …)` throws and the `catch` still returns `false`. The correct answer arrives, far too quickly.

So the `null` guard is a **timing** control, not a correctness one, and the timing tests are the only thing protecting it. Worth knowing before anyone simplifies it away on the grounds that the behaviour looks unchanged.

The HIBP client is injected, so no test reaches the network. One test asserts what *would* have been sent.

## 13. Observability

- `auth.breach_check_unavailable` — a security event, `warn`, carrying no password material.
- Hash parameters are logged **once at startup**, at `debug`, so a production incident can tell which parameters produced the stored hashes.
- Nothing logs a password, a hash, or an email beside either. `password` is already redacted by key name; the hash is never passed to a logger at all.

## 14. Open Questions

- **The measured parameters depend on the host.** They will be measured on the staging VM (4 cores, 15 GiB), which is the deployment target today. If production differs materially, they must be re-measured — recorded in the ADR as a condition rather than left implicit.
- **Rehashing on login when parameters change** is the standard companion to this (`argon2.needsRehash`). It belongs to `P1-03`, which is the only place a plaintext password and a stored hash exist together. Noted there rather than done here.
- **The breached-password check is on registration and password change only**, never on login. Checking at login would mean holding a plaintext password against a third-party call on the hottest auth path, for a control that cannot act — the account already exists.
