# Gift account numbers reclassified — and the risk that was hiding behind the wrong question

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Task** | `P1-13` (`OQ-10`) |
| **Phase** | Phase 1 preparation |
| **Surface** | docs |
| **Author** | Claude Code session |
| **Commits / PR** | (repository not yet under version control — `P0-03`) |
| **Status** | Completed |

---

## What Changed

`invitation_bank_accounts.account_number` is reclassified in the specification: it is **sensitive personal data that the couple enters in order to publish**, not a platform payment credential. `OQ-10` is answered — **no column-level encryption** — and the protection effort moves to integrity, where the actual loss is. A new risk, **R16**, and a new mandatory notification were added as a direct result. Recorded as ADR-025.

## Why

The project owner corrected a misconception: the account number exists so a guest who cannot attend can send a gift straight to the couple's own bank. The platform never uses it for any payment it processes.

`docs/SECURITY/00`'s data classification table had listed it in the same row as password hashes, refresh tokens and payment payloads, under "Critical". That grouping is what produced the wrong instinct in the first place — including mine, in the earlier framing of `OQ-10`, which described these as "the fields a database dump would be stolen for" and treated encryption as close to a foregone conclusion.

Other documents had it right all along. `docs/DATABASE/06` said "intentionally displayed by the owner on the public page (for digital gifts)", `docs/SECURITY/09` said "intentionally displayed by the user for digital gifts", and `docs/PLAN/00` even said "even if not fully financial PII". The classification table was the outlier, and it was the row an implementer would have read first.

## How

Re-deriving the decision from the corrected facts changed the answer.

**What encryption would actually protect.** For a published invitation with the gift section enabled, the number is served to every guest who opens the link — publication is the purpose. The database additionally holds numbers that are not public: drafts, invitations with the gift section toggled off, expired and soft-deleted ones. That non-public subset is the entire benefit of column encryption.

**Why that benefit is not worth the cost here.** The threat it addresses is a stolen dump — and the same dump holds full names, home and venue addresses, coordinates, phone numbers, photographs and complete guest lists in plaintext beside it. Encrypting one column does not change what a breach is or how it must be disclosed under the PDP law. The proportionate control for a stolen dump is encryption of the whole store, which `docs/DEVOPS/04` already requires for backups. Column encryption would also foreclose the one query worth having: whether an account number is reused across unrelated invitations, which is a genuine fraud signal.

**What the reframing exposed.** Once the field is understood as "a number published so that people will send money to it", the interesting attack changes direction. Confidentiality is not the property under threat — **integrity** is. An attacker who changes the account number on a live invitation, through an authorization bug or a compromised owner account, collects every guest's gift. The couple finds out after the wedding, from relatives asking why the money never arrived. Encryption does nothing about this. Nothing in the specification addressed it either, and no risk in `docs/PLAN/18` covered it — R6 covers leaking bank details through logs, which is the confidentiality half.

So the decision comes with three additions rather than an absence:

1. **R16** in the risk register: gift account tampering, Very High impact.
2. **Bank account writes are recorded** with actor and timestamp.
3. **A non-optional email to the owner** whenever gift details change on a published invitation, in the manner of a bank confirming a payee change — so a compromised owner finds out before the wedding rather than after.

The third is the one that matters most, and it did not exist before this conversation.

## Files and Components Touched

| Path | Change |
|---|---|
| `MEMORY/DECISIONS.md` | ADR-025 |
| `docs/SECURITY/00` | Classification split: "Critical — secrets" (impersonation on compromise) versus "Critical — sensitive personal data", with the gift account explicitly named as not a payment credential |
| `docs/SECURITY/09` | § Encryption rewritten: the decision, the reasoning, and the integrity controls that replace column encryption |
| `docs/DATABASE/06` | Column note rewritten |
| `docs/DATABASE/08` | `raw_callback_payload` scoped separately, with why redaction would work against its purpose |
| `docs/PLAN/13` | New notification row, and why it is not preference-gated |
| `docs/PLAN/18` | R16 added |
| `TASKS/PHASE-1` | `P1-13` goal and steps rewritten; new DoD items |
| `TASKS/PHASE-4` | `P4-07` and `P4-08` carry the new mandatory email |
| `TASKS/BACKLOG.md`, `TASKS/PROGRESS.md` | `OQ-10` answered; four open questions remain |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| No column encryption for `account_number` | Protects only the non-public subset, in a store full of comparable plaintext PII | ADR-025 |
| Storage-level encryption for the whole database instead | Matches the actual threat, a stolen dump | ADR-025 |
| Audit trail plus owner notification on gift account change | Tampering is the real loss for a number published to receive money | ADR-025 |
| `raw_callback_payload` treated separately, also unencrypted | Retained so a signature can be re-verified; redaction defeats the purpose | ADR-025 |

## Deviations from `docs/`

One, amended in the same change: `docs/SECURITY/09` proposed "considering" column-level encryption for this field. The specification now states the decision not to, with the reasoning, so a future reader does not re-open it from the same wrong premise.

## Tests Added

Not applicable — documentation only. Two obligations were written into `P1-13`: a test that changing a bank account on a published invitation writes an audit record and emits the owner-notification event, and a test that no log line contains a full account number.

## Security Verification

| Control | Change | Where it will be tested |
|---|---|---|
| Integrity of published gift details | New audit trail and owner notification | `P1-13`, `P4-07` |
| Object-level authorization | Unchanged in mechanism, raised in stated stakes — this is what stands between a compromised account and the guests' money | `P1-13`, `P6-01` |
| Confidentiality | Storage-level encryption plus log masking, replacing column encryption | `P6-11`, `P6-12` |

## Definition of Done Verification

Global DoD items 1-9 do not apply to a documentation change. Items 10 and 11 are met: this record, the index and changelog entries, ADR-025, and the `TASKS/` updates all land together.

## What Did Not Work

The original framing of `OQ-10` — mine — asserted that these were "the most sensitive fields the product stores" and "the fields a database dump would be stolen for". That was inherited uncritically from `docs/SECURITY/00`'s classification table rather than derived from what the field is for, and it pointed at a control that would have cost real work while protecting a small subset of the data and missing the attack that actually matters.

Worth recording because the mechanism is general: a classification table is a summary, and a summary that groups a published gift number with a password hash will produce wrong decisions downstream from people who read the summary and not the three other documents that were more careful. The fix was to make the table itself distinguish "compromise means impersonation" from "sensitive personal data the owner chose to publish".

## Follow-Ups and Open Questions

- Storage-level encryption at rest for the database is now load-bearing rather than a nice-to-have. `P0-05` and `P0-23` should confirm it is actually enabled on the VPS deployment, not assumed — self-hosted Postgres does not encrypt at rest by default.
- The gift account change email needs copy that is useful to a non-technical recipient: what changed, when, and what to do if it was not them.
- Reuse of one account number across unrelated invitations remains a fraud signal nobody is watching yet. Not urgent at MVP volume; worth a query once there is data.

## What to Watch

R16 is the one to watch, and its symptom is silence. Tampering with a gift account produces no error, no failed request and no alert — the page renders perfectly, with the wrong number. The only signals are the audit trail and an owner who reads the notification email. If that email is ever made preference-gated "to reduce noise", the control is gone and nothing will indicate that it went.
