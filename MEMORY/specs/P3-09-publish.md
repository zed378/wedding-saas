# P3-09 — Feature Spec: Publish

| | |
|---|---|
| **Task** | `P3-09` |
| **Date** | 2026-09-15 |
| **Author** | Claude (autonomous run) |
| **Status** | Implemented |

---

## 1. Goal

`POST /api/v1/invitations/:id/publish` makes an invitation live at `{PUBLIC_INVITE_ORIGIN}/{slug}` — for a
paid invitation until its package's validity runs out, or once, for three days, as a free trial — after
every check in `docs/BACKEND/02`'s order.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/BACKEND/02` | publish example | ownership → paid → required fields → slug → transaction with history → event |
| `docs/BACKEND/06` | Publish, Slug Validation | cache warm, `invitation.published`, slug re-check + unique-violation → 409 |
| `docs/PLAN/10` | Publish Flow | `published_at = now()`, `expiry_date = now() + package_duration` |
| `docs/PLAN/02` | BR-2.4, BR-2.8, BR-4.2, BR-6.1 | paid → published; trial once for 3 days; required fields; slug rules |
| `docs/API/01` | step 2 | publish requires a verified email |
| `docs/API/04` | § Publish | 422 `details[]` identical to `publish-check` |
| `docs/API/08` | `display.watermark` | server-derived |
| ADR-052 | — | trial publish; no new column; eligibility from `invitation_status_history` |

**Gaps**:
1. The state machine allows `published` only from `paid`. BR-2.8 needs `draft → published` for the trial —
   added, USER, with the eligibility check in the service (the machine cannot see history). ADR-080.
2. The public page renders a watermark only on previews; a trial publish is watermarked (ADR-052) but a
   guest would see none. A small "trial" notice is added to the public page when `display.watermark` is
   true. Its look is `OQ-13`'s; this is deliberately minimal.
3. Caching and invalidation are `P3-12`'s card; the public fetch is `no-store`, so "live within five
   seconds" holds without a cache to warm. `P3-12` must invalidate on publish.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-2.4 | A paid invitation can be published | `PublishService` status table |
| BR-2.8 | Trial: never paid and never published before, 3 days | `PublishService` + history predicate |
| BR-4.2 | Required fields | `PublishCheckService` (strict mode) |
| BR-6.1 | Slug valid, not blocked, unique | `SlugService.check` at publish |

## 4. API Contract

`POST /api/v1/invitations/:id/publish`, authenticated, no body (any field is 400).

`200 { status: "published", slug, url, published_at, expiry_date, trial }`.

| Situation | Answer |
|---|---|
| Not the caller's / deleted / malformed | 404 |
| Email not verified | 403 `EMAIL_NOT_VERIFIED` |
| Required fields missing | 422 `INCOMPLETE_INVITATION`, `details[]` = `publish-check`'s |
| No slug | 422 `SLUG_REQUIRED` |
| Slug malformed / blocked | 422 `SLUG_INVALID` / `SLUG_BLOCKED` |
| Slug held by another live invitation (race) | 409 `SLUG_TAKEN` |
| Already published | 422 `INVITATION_ALREADY_PUBLISHED` |
| Awaiting payment | 422 `PAYMENT_PENDING` |
| Unpaid and the trial was used (draft or expired) | 422 `TRIAL_ALREADY_USED` — message names paying as the way on |
| Paid once, now expired | 422 `RENEWAL_REQUIRED` |

## 5. Data Model Impact

`invitations.status` (status service), `published_at`, `expiry_date`; `invitation_status_history`. No
migration.

## 6. Authorization

Owner-scoped lock `WHERE id AND owner_id AND deleted_at IS NULL FOR UPDATE`; 404 otherwise. Verified email.

## 7. Validation and Sanitization

No body. Slug re-validated from the stored value.

## 8. State Transitions

| From | Condition | To | `expiry_date` |
|---|---|---|---|
| `paid` | — | `published` | WIB today + the paid package's months (`EntitlementsService`) |
| `draft` | never reached `paid` or `published` | `published` (trial) | WIB today + 3 days |

Checked under the lock; history row reason `user: publish` / `user: free trial publish (BR-2.8)`.

## 9. Side Effects

After commit: `notification.send` `{ template: "invitation_published", invitationId }` (sent by `P4-06`);
`invitation.published` log. No cache (`P3-12`).

## 10. Failure Modes

Double click: the lock serialises; the second sees `published` → 422. Template definition unreadable:
publish refuses (503-shaped error) — the advisory check may say ready, the gate may not guess.

## 11. Abuse Cases

| Abuse case | Expected | Test |
|---|---|---|
| Republish a lapsed trial for free | 422 `TRIAL_ALREADY_USED` | `publish.itest.ts` › "refuses a second trial after the first lapsed" |
| Trial again after unpublishing? (P3-10 returns trial to `paid`? No — to its own rule) | covered by history predicate | "refuses a trial for an invitation that was ever published" |
| Another user's invitation | 404 | IDOR test + sweep |
| Unverified user | 403 | `publish.itest.ts` |

## 12. Test Plan

Integration: paid publish with package months; trial with 3 days and watermark; second trial refused
(lapsed); every status in the table; incomplete → 422 with the check's details; slug required/blocked/taken;
unverified; IDOR; double publish. HTTP: body refused, response shape. Public page: watermark notice. E2E:
publish through the API, page reachable within 5 s.

## 13. Observability

`invitation.published` (info: trial flag, expiry).

## 14. Open Questions

`OQ-13` (watermark look) — minimal notice until answered.
