# Specification gap remediation — all 17 gaps closed

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Task** | — (amendments owed by `P0-09`, `P0-13`, `P1-02`, `P1-14`, `P1-15`, `P1-17`, `P2-12`, `P3-01`, `P3-02`, `P3-09`, `P4-02`, `P4-04`, `P4-09`, `P5-02`, `P5-08`, `P5-13`, brought forward) |
| **Phase** | Pre-Phase-0 |
| **Surface** | docs |
| **Author** | Claude Code session |
| **Commits / PR** | (repository not yet under version control — `P0-03`) |
| **Status** | Completed |

---

## What Changed

The 17 specification gaps recorded in `TASKS/BACKLOG.md` are resolved and `docs/` is amended. Two were genuine contradictions between documents; the rest were capabilities the specification required functionally but never modelled. Five tables and six endpoints were added, two `docs/DATABASE/` files created, and 24 documents amended. Five ADRs record the reasoning (ADR-018 through ADR-022).

## Why

Requested directly: fix all the contradictions with the most sensible, best-practice approach.

Doing it now rather than task by task matters more than it looks. Each gap was scheduled to be resolved by whichever task first hit it — `PG-01` by `P0-13`, `PG-14` by `P5-08`, and so on — which meant the answer would have been chosen under implementation pressure, months apart, by whoever happened to be there. Two of them would have been decided inconsistently across endpoints before anyone noticed.

## How

Each gap was resolved by reading what the rest of the specification already implied, rather than by picking a preference. The two contradictions are worth stating in full because they had consequences:

**`PG-01` — 403 versus 404.** `docs/API/00` documented both answers for "the resource exists but is not yours". Four other documents — `SECURITY/04`, `SECURITY/05`, `TESTING/04` and `CLAUDE.md` — all said 404, and `docs/API/05` then specified 403 for one case. The rule is now 404 everywhere, with 403 reserved for a role the caller lacks or an unverified email, where no resource identity is revealed. Left alone, this would have produced a system where some endpoints confirm the existence of other users' invitations and some do not, and the inconsistency itself would have been the finding.

**`PG-14` — refund target status.** `docs/PLAN/02` BR-5.4 said `draft`; `docs/BACKEND/05` said `paid`; `docs/BACKEND/09` hedged. The difference decides whether a customer who has been refunded can put their invitation back online for free. Resolved to `draft`, because a refund reverses the entitlement rather than only the payment. This is the gap with a money consequence, and the one most likely to have been implemented from whichever document the developer happened to open.

The remaining fifteen were omissions with a clear right answer available from context. The choices worth naming:

- **Everything credential-shaped is stored hashed or encrypted** — verification and reset tokens, preview tokens and recovery codes hashed; TOTP secrets encrypted at the application layer. This follows the reasoning `docs/DATABASE/02` had already applied to refresh tokens, extended to the four new token types.
- **View counts are daily rows, not one lifetime total** — because the question an owner asks in the week before the wedding is "is anyone opening the link I sent yesterday", and a daily row can be pruned without losing the total.
- **The slug blocklist distinguishes exact from substring matching** — blocking reserved words as substrings would reject legitimate Indonesian names, and a couple named Aprilia should not lose their slug to a routing concern.
- **Version upgrade is a separate endpoint from template change** — both write `template_version_id`, but they carry different warnings, and one endpoint would force one confirmation dialogue to explain both.
- **Guest reporting flags rather than hides** — a public endpoint that could remove a message from a stranger's wedding page is a denial-of-service tool with a friendly name.
- **The CSV export escapes formula-leading cells** — the file is opened by non-technical users and forwarded to clients (`docs/UI-UX/04`, the organizer journey), which is exactly the path a spreadsheet injection travels.

## Files and Components Touched

| Path | Change |
|---|---|
| `docs/API/00` | 403 versus 404 status rows plus a new section with the reasoning |
| `docs/API/04` | Owner RSVP endpoints, owner guestbook moderation, version upgrade, preview link list and revoke |
| `docs/API/05` | `GET /media/:media_id`; 403 corrected to 404 |
| `docs/API/06` | Order creation performs the `pending_payment` transition; renewal orders do not |
| `docs/API/08` | `display.watermark`, `GET /public/preview/:token`, guest report endpoint |
| `docs/API/09` | Owner versus platform moderation boundary stated |
| `docs/ARCHITECTURE/04` | Schema summary corrected — three tables listed there do not exist |
| `docs/BACKEND/05`, `09` | Refund sets `draft`, with the reasoning and the test expectation |
| `docs/DATABASE/00`, `01` | Table groups and ERD updated |
| `docs/DATABASE/02` | `user_tokens`, `user_mfa_factors`, `user_recovery_codes` |
| `docs/DATABASE/04` | `invitation_preview_tokens` |
| `docs/DATABASE/07` | Addon availability gating note |
| `docs/DATABASE/11-ANALYTICS.md` | **New file** — `invitation_view_counts` |
| `docs/DATABASE/12-PLATFORM-CONFIG.md` | **New file** — `slug_blocklist` |
| `docs/PLAN/02`, `06` | BR-5.4 expanded; lifecycle transition rules |
| `docs/PLAN/07` | Demo data as a seeded system-owned invitation |
| `docs/PLAN/08` | Where settings fields physically live |
| `docs/PLAN/09` | Add-on availability at MVP |
| `docs/PLAN/12`, `14` | Moderation queue sources; analytics table pointer |
| `docs/SECURITY/01`, `10`, `11` | 404 wording; blocklist table pointer; IDOR sweep criterion |
| `docs/README.md` | File counts, and a pointer to `TASKS/` and `MEMORY/` |
| `TASKS/BACKLOG.md` | Gap section rewritten as a resolution record |
| `TASKS/PHASE-0…5` | Every "resolve `PG-xx` first" step replaced with the resolved instruction |
| `TASKS/PROGRESS.md` | Amendments-owed table replaced with amendments-completed |
| `MEMORY/DECISIONS.md` | ADR-018 through ADR-022 |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| 404, never 403, for another user's resource | A differentiating status code is an enumeration oracle | ADR-018 |
| Refund returns the invitation to `draft` | A refund reverses the entitlement, not only the payment | ADR-019 |
| Five tables added, all credential-shaped data hashed or encrypted | Consistency with the reasoning already applied to refresh tokens | ADR-020 |
| Six endpoints added | Features the product documents specify in detail had no contract | ADR-021 |
| Five documentation corrections | Each was a place an implementer would have had to stop and choose | ADR-022 |

## Deviations from `docs/`

None — this **is** the amendment of `docs/`, performed under the deviation protocol in `TASKS/00-TASK-CONVENTIONS.md`. Every change is recorded in an ADR naming the documents amended.

## Tests Added

Not applicable — documentation only. The amendments do create new test obligations, which are already written into the task cards: the CSV formula-injection test (`P4-02`), the preview-token indistinguishability test (`P2-12`), the refund cache-invalidation test (`P5-08`), and the 404 sweep (`P6-01`).

## Security Verification

Not applicable directly. Four amendments tighten a security control rather than describe one:

| Control | Change | Where it will be tested |
|---|---|---|
| Object-level authorization | 404 is now unambiguous across every endpoint | `P6-01` — a 403 in the sweep is now a finding |
| Credential storage | Four new token types specified as hashed; TOTP secret encrypted | `P1-02`, `P2-12`, `P5-02` |
| Entitlement reversal | Refund state and immediate cache invalidation specified | `P5-08` |
| Abuse surface | Report endpoint flags rather than hides; rate limited | `P5-09` |

## Definition of Done Verification

Global DoD items 1-9 are not applicable to a documentation change. Items 10 and 11 are met: this record exists, `MEMORY-INDEX.md` and `CHANGELOG.md` are updated, five ADRs are written, and `TASKS/PROGRESS.md` plus the phase files are updated in the same change.

## What Did Not Work

The first pass at `PG-02` (slug and expiry living in `Settings` per `PLAN/08` but on `invitations` per `DATABASE/04`) tried to make the two documents agree by moving the columns into `invitation_settings`. That was abandoned once the consequence was traced: the public request path queries `WHERE slug = ? AND status = 'published'`, so moving those columns adds a join to the single hottest query in the product, in service of tidiness. The domain model and the physical schema are allowed to differ; what was missing was the mapping, which is now written down.

## Follow-Ups and Open Questions

- `docs/DATABASE/` grew from 11 to 13 files, so `P0-09` and `P0-10` are slightly larger than their `L`/`M` sizes suggested. Not resized yet — worth revisiting when they start.
- The seeded demo invitation (`PG-08`) needs a system account that does not appear in user-facing counts. `P0-21` and `P5-11` both touch that; whichever runs second should check the other honoured it.
- `OQ-13` (what the watermark looks like) remains open; only its transport was settled here.

## What to Watch

The gaps are closed in the documents, not in anyone's memory. The failure mode from here is a task being implemented from a stale reading — someone who read `docs/BACKEND/05` last month and still believes a refund sets `paid`. The mitigation is already in the working discipline: `TASKS/00-TASK-CONVENTIONS.md` § Definition of Ready requires the `Spec refs` documents to be read *for this task*, not remembered from a previous one. This is the change that makes that rule matter.
