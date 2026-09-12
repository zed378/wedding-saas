# P1-13 — Gift accounts and quote sub-resources

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-13 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-13-bank-quote` |
| **Status** | Completed |
| **Spec** | Written into this record. The card's step 4b *is* the specification for the part that matters |

---

## What Changed

Gift account CRUD and `GET`/`PATCH /invitations/:id/quote`, with the three integrity
controls the card asks for: an audit row inside the same transaction as every change, an
owner notification when a **published** invitation's account changes, and a format check on
`account_number` in place of sanitization.

## Why

`docs/API/04`, and ADR-025 / `docs/SECURITY/09` § Encryption for what this data is.

The threat model here is inverted from the rest of the product. A gift account number is
**data the couple enters in order to publish it** — on a published invitation with the gift
section on, it is already served to every guest who opens the link. Disclosure costs them
almost nothing. **Substitution costs them everything their guests sent** (`docs/PLAN/18`
R16): an attacker who swaps the number on a live invitation collects the lot, and the couple
may not find out until after the wedding.

So the controls are integrity controls, not secrecy ones.

## How

**The audit row is inside the transaction, and there is no way to call the write without
it.** `createBankAccount`, `updateBankAccount` and `deleteBankAccount` each take an `audit`
callback and invoke it inside their own `db.transaction`. A caller cannot obtain the write
without supplying the trail, and a failing audit rolls the change back — which has its own
test, because "in the same transaction" is a claim and a test is what makes it one.

**The audit row carries a masked number.** `docs/DATABASE/10` § Policy asks to "avoid
unnecessarily duplicating bank account data" in audit rows, and a two-year retention over a
table of full account numbers would be a larger liability than the one the policy warns
about. The last four digits are what the owner needs to recognise which account changed.

**The notification fires only when the invitation is published.** On a draft it would be
noise, and an email per keystroke trains the owner to ignore the one that matters. On a
published invitation the number is in front of guests right now, and an unexpected change is
the signal that somebody else is in the account — the way a bank confirms a payee change.

**`account_number` gets a character allowlist, not sanitization.** `P1-16` exempted it on the
argument that tag stripping would silently alter a value whose exact characters matter, and
promised a format check instead. This is that check: `^[0-9][0-9 -]{3,58}[0-9]$`, so markup
is impossible in the first place. Whitespace is trimmed rather than rejected — somebody
pasting from their banking app brings it with them.

**Not column-encrypted** (ADR-025). Encryption would protect only drafts and
gift-section-off invitations, inside a database holding names, home addresses, venue
coordinates and complete guest lists in plaintext beside it. Storage-level encryption covers
the whole store.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/modules/invitation/gift.service.ts` | **New** — `GiftService` and `QuoteService` |
| `backend/api/src/shared/tenancy/invitation-repository.ts` | Bank account CRUD with mandatory audit callbacks, `updateQuote`, `findOwnedBankAccount(s)`, `findOwnedQuote`, two row types |
| `backend/api/src/modules/invitation/invitation.controller.ts` | Six endpoints, `ACCOUNT_NUMBER` format |
| `backend/api/src/modules/invitation/invitation.module.ts` | Providers, `AuditModule` |
| `backend/api/test/integration/gift-quote.itest.ts` | **New** — 34 tests |
| `backend/api/test/invitation-http.spec.ts` | 23 tests added |

No migration.

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| The audit callback is a **required argument** of each write | A caller cannot record a change and then have the change fail, or vice versa | — |
| Audit rows carry a masked number | `docs/DATABASE/10` § Policy; two years of full numbers is a worse liability | — |
| `audit_logs.admin_id` holds the acting **user**, not only an admin | See *Deviations* | ADR-053 |
| The notification is published-only | A draft would be noise; a live invitation is the case that matters | — |
| `account_number` is format-checked, not sanitized | Tag stripping would alter a value whose exact characters matter | Promised by `P1-16` |
| The owner sees the full number in their own editor | They typed it and will publish it; masking it would make the field impossible to check | — |
| `updateQuote` is an upsert | `P1-09` creates the row, but an invitation predating that would 404 on a field the editor shows | — |

## Deviations from `docs/`

**One, recorded as ADR-053.** `docs/DATABASE/10` describes `audit_logs` as the trail for
admin endpoints, and its `admin_id` is `NOT NULL REFERENCES users(id)`. This task writes
rows there for an **owner** acting on their own invitation.

The alternative was a separate `invitation_bank_account_history` table. It was rejected
because it would split "who changed this gift account" across two places depending on
whether an admin or the owner did it — and an incident asks that question without knowing
the answer in advance. One place to look is worth more than a column name being literally
accurate.

`docs/DATABASE/10` § Policy already anticipates bank account data reaching this table
("avoid unnecessarily duplicating bank account data"), which is the strongest hint that it
is the intended home. The document was amended to say the actor may be the resource's owner
for owner-sensitive resources; the column keeps its name, and renaming it to `actor_id`
under expand-contract is noted as optional future work.

## Tests Added

57 (34 integration, 23 HTTP). API integration 522 → 556; unit 387 → 410.

| Group | Cases |
|---|---|
| CRUD | create, list, update, delete; **the owner sees the full number**; `display_order` appends; an empty patch is a read |
| **The audit trail** | create, update and delete each write a row; **update records before AND after**; **the row carries a masked number, never the full one**; **a failing audit rolls the write back**; **a failing audit on update leaves the old value**; a refused write leaves no row |
| **Published notification** | emitted on create and update; **carries a masked number**; **silent on a draft**; a security-adjacent warning is logged; **a failing queue does not undo the change** |
| **Logs** | the `P0-12` redactor masks `account_number`, `accountNumber` and a nested occurrence; the service's own log line contains no long digit run at all |
| Cross-invitation `:bank_id` | another tenant's id is 404 **and the value is unchanged**; my other invitation's id is 404; delete across invitations deletes nothing; list and create are refused |
| Each repository layer alone | `updateBankAccount` and `deleteBankAccount` write nothing for a foreign scope; `findOwnedBankAccount` refuses the wrong parent **and finds it on the right one** |
| The quote | stores text and source; reads back; partial; `null` clears; **works with no existing row**; cross-tenant read and write refused; `updateQuote` writes nothing for a foreign scope |
| Soft delete | gift accounts hidden; a quote write refused |
| HTTP | all six routes; two 404s; **six `account_number` rejections**; four accepted forms including trimmed whitespace; an unknown type rejected; **`provider_name` and `account_holder` sanitized while the number is untouched**; quote read/write, sanitization, `null`, three rejections, 404 |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| No log line contains a full account number | Card DoD 1 and 3 | Two tests against a real logger with a captured destination — one over three key spellings including a nested one, one asserting the service's own line has no digit run of six or more |
| A change is inseparable from its audit row | Card step 4b | `"a FAILING audit rolls the write back"` and the update equivalent. **Mutation**: storing the full number instead of the masked one fails `"the audit row carries a MASKED number"` |
| Audit rows do not accumulate account numbers | `docs/DATABASE/10` § Policy | Same mutation; the test asserts both the old and new numbers are absent and the mask is present |
| A change to a live invitation reaches the owner | Card DoD 2 | `"emits on create, update and delete"`. **Mutation**: removing the `status !== "published"` guard fails `"stays quiet on a draft"` — which proves the guard is doing work rather than the test passing by accident |
| Cross-invitation `:bank_id` is 404 | Card DoD 4, `docs/SECURITY/05` § 7 | Three service tests, each also asserting nothing changed, plus three repository-level tests (the `P1-12` lesson) |
| `account_number` cannot carry markup | `P1-16`'s exemption | Six HTTP rejections including `<script>`; the allowlist makes a tag unrepresentable |
| The quote is sanitized | Card DoD 5 | `"sanitizes both fields"` at the HTTP boundary |

## Abuse Cases Covered

R16 substitution on a live invitation (audited and notified), cross-invitation `:bank_id` in
three forms, markup in `account_number`, stored XSS in `provider_name`, `account_holder`,
quote `text` and `source`, and a full account number reaching a log.

## DoD Verification

- [x] Account numbers never appear unmasked in any log. Two tests against a real logger, covering three key spellings and a nested object.
- [x] Changing a bank account on a published invitation writes an audit record and emits the owner-notification event, proven by a test. Both, and the mutation that makes the published guard matter.
- [x] No log line anywhere contains a full account number. As above; the service's own line is asserted to contain no digit run at all.
- [x] Cross-invitation `:bank_id` returns 404. Three service tests and three repository-level ones.
- [x] The quote endpoint stores `{text, source}` and sanitizes both.

## What Did Not Work

**1. A test asserted the wrong friendly behaviour.** I wrote that an account number with a
leading space should be rejected; `.trim()` runs before the regex, so it is accepted with the
space removed. That is the better behaviour — somebody pasting from their banking app brings
whitespace with them, and refusing it would be a worse product for no security gain, since
the character allowlist still applies to what remains. The test now asserts the trim
explicitly rather than being deleted.

**2. `audit_logs` needed a decision, not a shortcut.** Its column is `admin_id` and its
document describes admin endpoints. Writing owner actions there is a deviation; writing them
somewhere else splits the answer to "who changed this gift account" across two tables. ADR-053
records the choice and the rejected alternative.

## Follow-Ups and Open Questions

- **`P4-07` owes the email.** The event is enqueued with the masked number, the provider name
  and what changed; the worker logs it until `P4-06` has a provider. The card calls this
  notification "non-optional", which is a property of `P4-07`, not of this task.
- **`audit_logs.admin_id` could be renamed `actor_id`** under expand-contract. Optional; the
  meaning is documented and the column name is the only thing that is now slightly wrong.
- **Nothing enforces one gift account per provider.** `docs/DATABASE/06` sets no such
  constraint and the product has no reason to; noted only because a duplicate looks like a
  bug in a list.

## What to Watch

**The audit callback is easy to make optional.** It is currently a required parameter, which
is what makes the guarantee structural. A future refactor that gives it a default — or moves
the `record()` call outside the transaction "for clarity" — removes the property without
failing any test except the two rollback ones. They are named for that reason.

**The published-only notification will look like a bug.** Somebody will report that editing
a gift account on a draft sends no email. It is deliberate, and the reasoning is at the
function.
