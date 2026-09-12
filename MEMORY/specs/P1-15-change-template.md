# P1-15 — Feature Spec: Change Template Without Data Loss

| | |
|---|---|
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-15 |
| **Date** | 2026-09-12 |
| **Author** | Claude Code session |
| **Status** | Draft |

---

## 1. Goal

An owner can move an invitation to a different template and keep everything they have
typed. `POST /invitations/:id/change-template` swaps the presentation layer — `template_id`,
`template_version_id`, the section selection and the theme overrides — and touches no
invitation content at all. The response names what will stop being displayed, so the
editor's confirmation modal can say it before the user commits.

The load-bearing word is *displayed*. BR-4.1 makes "not supported by this template" a
rendering decision, never a storage one: the gallery photos of someone who switches to a
template with no gallery section are still there, and come back the moment they switch to a
template that has one.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/04-INVITATION-API.md` | line 12, and the note at line 16 | `POST /api/v1/invitations/:id/change-template { template_id }`. Separate from `upgrade-template-version` because the two carry different warnings. Neither is ever automatic (BR-3.1) |
| `docs/PLAN/07-TEMPLATE-SYSTEM.md` | § Template Compatibility & Migration | The matching rule is `section_key` equality. "Unrecognized sections are hidden, not deleted (backward-safe)" |
| `docs/PLAN/02-BUSINESS-RULES.md` | BR-3.1, BR-3.3, BR-4.1 | A concrete version is stored, not "latest". A deprecated version still renders but is not offered. Unsupported section data stays in the database |
| `docs/UI-UX/05-USER-FLOWS.md` | § Change Template Flow (lines 46-50) | The confirmation modal says "X fields may not be displayed in this template" **with the fields listed**, and after the change "old data remains" |
| `docs/PLAN/17-ACCEPTANCE-CRITERIA.md` | line 8 | "Users can switch templates without losing data (BR-3, tested with a scenario where fields disappear and reappear)" — the round trip is an acceptance criterion, not only a card DoD |
| `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` | § 1, § 3 | Ownership at the query level; a lifecycle field must not be reachable through a body |
| `docs/DATABASE/10-AUDIT-LOGS.md` | § Policy | The trail carries the relevant fields only, and the row is written in the same transaction |

**No disagreement between sources.** `docs/API/04` does not specify the *response* body for
this endpoint — it lists the request only. Card steps 4 and 5 require the response to name
the affected sections and the dropped theme keys, so the shape below is added to
`docs/API/04` in this task rather than invented here and left undocumented.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-3.1 | An invitation stores a concrete `template_id` + `template_version_id`, never "latest" | `ChangeTemplateService.resolvePublishedVersion` — the new version is resolved once, at the moment of the change, and written as a value |
| BR-3.3 | A deprecated template still renders for invitations on it, but is not offered for a change | Only `status = 'published'` versions are resolvable as a *target*; the invitation's current version is never re-checked |
| BR-4.1 | Unsupported section data is hidden, not removed | `InvitationRepository.changeTemplate` writes `invitations` and `invitation_settings` and nothing else. There is no `DELETE` in the path, and the test asserts row counts across every child table |
| BR-4.2 | Required fields must not be empty when publishing | **Not enforced here** — see § 14. A template change can leave a *published* invitation missing a field the new template marks required |

## 4. API Contract

- **Method and path**: `POST /api/v1/invitations/:id/change-template`
- **Request** (`.strict()`, one field):

```json
{ "template_id": "uuid" }
```

  Nothing else is accepted. `template_version_id` in particular is absent: a client that
  could name a version could pin an invitation to a `draft` one and walk around BR-3.3.

- **Success** — 200, in `docs/API/00`'s envelope:

```json
{
  "data": {
    "template_id": "uuid",
    "template_version_id": "uuid",
    "enabled_sections": ["hero", "gallery"],
    "hidden_sections": ["gift"],
    "dropped_theme_keys": ["colors.accent"]
  }
}
```

  `hidden_sections` is what the invitation had enabled and the new template does not define
  — the list the modal in `docs/UI-UX/05` shows. `dropped_theme_keys` is what was removed
  from `theme_override` because the new template does not list it as customizable.

- **Errors**
  - 404 `NOT_FOUND` — not the caller's invitation, soft-deleted, never existed, **or** the
    `template_id` does not exist. From the caller's side an unknown template and one that
    does not exist are the same thing, which is how `P1-09` already treats it.
  - 422 `TEMPLATE_NOT_AVAILABLE` — the template exists but has no published version (BR-3.3).
  - 422 `TEMPLATE_UNCHANGED` — the invitation is already on this template. Refused rather
    than silently succeeding, because the response's whole purpose is to describe a change.
    Re-resolving the version would also make this endpoint a covert
    `upgrade-template-version`, which `docs/API/04` line 16 deliberately keeps separate.
  - 400 — a body carrying any other field.
  - 401, 429 — as every other invitation endpoint.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `invitations` | read + write | `template_id`, `template_version_id`, `updated_at`. Nothing else |
| `templates` | read | existence, and that it is not the current one |
| `template_versions` | read | the newest `published` version of the target, and both templates' `sections` / `customizable_theme_keys` |
| `invitation_settings` | read + write | `enabled_sections`, `theme_override` recomputed. Upserted, because a row may predate `P1-09` |
| `audit_logs` | write | one `invitation.change_template` row, in the same transaction |
| every other `invitation_*` table | **neither** | this is the point of the feature |

**Migration required: no.**

## 6. Authorization

- **Who may call**: the authenticated owner. `requireAuth()` on the controller; email
  verification is not required, matching `P1-09` — `docs/API/01` gates publish and checkout,
  not editing.
- **How ownership is enforced, and where**: at the query level, in
  `shared/tenancy/invitation-repository.ts`. `findOwned` for the read and
  `changeTemplate`'s own `WHERE id = ? AND owner_id = ? AND deleted_at IS NULL` for the
  write. The write does not trust the read: both carry the filter, so the method is safe
  even if a future caller skips the load.
- **A non-owner receives 404**, never 403, and cannot tell "not yours" from "does not exist".
- **Nested ids**: `template_id` is a body field, not a nested path id, and templates are not
  tenant-owned — there is no owner to compare it against. The two-step rule does not apply,
  but the *reverse* concern does: resolving the version must not be a way to learn which
  template ids exist. It is not, because the ownership check runs first and an unknown id
  and a real one both produce 404 for a caller who does not own the invitation.
- **Admin path**: none. An admin changing a customer's template is not a support action
  anybody asked for.

## 7. Validation and Sanitization

- **Structural** (controller): `z.object({ template_id: z.uuid() }).strict()`.
- **Business** (service): the target exists, has a published version, and is not the current
  template.
- **Free text**: none. There is no prose in this request, so nothing to sanitize — and
  `scripts/check-sanitized-fields.mjs` must still be satisfied, which for a `z.uuid()` field
  means registering it in `NOT_USER_TEXT` with a real reason.
- **Not accepted from the client**: `template_version_id`, `enabled_sections`,
  `theme_override`, and every lifecycle field. The whole point of the endpoint is that the
  server computes the consequences; a client that could send `enabled_sections` alongside
  could enable a section the new template does not define and undo `P1-14`'s boundary.

## 8. State Transitions

**None.** `status` does not change, so no `invitation_status_history` row is written and
`scripts/check-status-writes.mjs` stays satisfied without an exemption. A template change is
not a lifecycle event: an invitation that was `published` before is `published` after, on a
different design.

The trail asked for by card step 6 goes to `audit_logs`, not to the status history —
`to_status` is `NOT NULL` there, and inventing a status to satisfy a column would corrupt
the one table whose job is to answer "how did this invitation get here".

## 9. Side Effects

| Effect | Inside or after the transaction | Why |
|---|---|---|
| `audit_logs` row | **inside** | `AuditLogService.record` takes a `Transaction` and cannot open its own. An audit row that commits when the change rolled back is a false record that looks exactly like a true one |
| structured log line | after | Logging is not part of the change, and a logger failure must not roll one back |
| public page cache invalidation | **not implemented** | There is no cache to invalidate in Phase 1; the keys in `ARCHITECTURE/06` arrive with `P2-07`. Recorded as a follow-up on that card rather than left implicit |
| notification to the owner | none | They are looking at the screen that did it |

## 10. Failure Modes

- **Database down** — the whole request fails with the standard 500. Nothing is written,
  because the two writes and the audit row are one transaction.
- **The transaction aborts between the two writes** — impossible to observe: `invitations`
  and `invitation_settings` commit together. A half-applied change (new version, old
  sections) would render an invitation against a definition that does not describe it.
- **Redis down** — the rate limiter's existing `P1-07` behaviour. This endpoint is not
  security-critical enough to fail closed on a cache outage, and it inherits an existing
  policy rather than deciding for itself.
- **A concurrent change of the same invitation** — last writer wins, which is correct here:
  both callers are the owner, and the result is a consistent state either way.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Changing another user's template | `SECURITY/05` § 1 | 404, and the victim's `template_version_id` unchanged | `"a foreign scope cannot change my template, and mine does not move"` |
| Pinning an invitation to a `draft` template version | BR-3.3 | 422 `TEMPLATE_NOT_AVAILABLE`; `template_version_id` is not a request field at all | `"a template whose only version is a draft is refused"` |
| Smuggling `enabled_sections` to enable an undefined section | `SECURITY/05` § 3, `P1-14` | 400 from `.strict()` | `"rejects a body carrying enabled_sections"` |
| Smuggling `status` or `owner_id` | `SECURITY/05` § 3 | 400 | `"rejects a body carrying %s"` |
| Using the endpoint to enumerate template ids | `SECURITY/01` | 404 either way, ownership checked first | `"an unknown template id is 404"` |
| Churning templates to drive load | `SECURITY/10` | rate limited on a per-user policy | `"is rate limited"` |
| A section key surviving as a ghost in `enabled_sections` | BR-4.1 + `P1-14` | the recomputed list contains only keys the new template defines, so a later settings save cannot 422 on a value the server itself wrote | `"the recomputed selection is always valid under the new template"` |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit | `recomputeSections` — intersection, new defaults added, a section the user had turned off stays off, a **non-configurable** section of the new template is forced on, duplicates impossible, malformed `sections` JSON tolerated. `dropThemeKeys` — exact key matching, nested keys, nothing dropped when all are permitted |
| Integration | the happy path; `hidden_sections` named; `dropped_theme_keys` named; the **round trip A → B → A** with people, events, gallery, bank accounts, quote and guestbook rows seeded, asserting row-for-row equality afterwards; every child table's row count unchanged; the audit row written with before/after; `TEMPLATE_UNCHANGED`; `TEMPLATE_NOT_AVAILABLE`; unknown template 404; IDOR at service and repository level; soft-deleted invitation 404 |
| HTTP | 200 shape; `.strict()` rejections including `enabled_sections` and `template_version_id`; 404; 401; rate limited |
| Security | the IDOR pair above, plus **mutation tests**: dropping the `owner_id` filter from `changeTemplate` must fail a named test, and removing the non-configurable force-on must fail a named test |

## 13. Observability

One `info` line: `event: "invitation.template_changed"`, with `invitation_id`, `user_id`,
`from_template_version_id`, `to_template_version_id`, and the **counts** of hidden sections
and dropped theme keys. Not the values — a section key is not sensitive, but the count is
what an alert would trigger on, and `P1-04` is the standing reminder that a log line is a
place data leaks to.

A `warn` line when the invitation is `published` at the time of the change, because that
changes what several hundred guests are currently looking at and it is the one case where
someone reading the log later will want to know it happened.

## 14. Open Questions

1. **May a `published` invitation change template at all, and if so must the publish check
   re-run?** No document forbids it, and BR-2.5's "data is not lost" ethos suggests the
   answer is yes. But BR-4.2 requires the template's `required_fields` to be non-empty at
   publish time, and a change can leave a live invitation failing that check with no
   re-validation anywhere. Implemented as **allowed, logged at `warn`**, because refusing
   would be inventing a rule; raised in `TASKS/BACKLOG.md` for the owner to settle before
   `P2-06` builds the publish check.
2. **`upgrade-template-version` has no owning task card.** `BACKLOG.md` PG-16 records the
   gap and proposes the endpoint, and `P1-10`'s card says it "belongs with the template
   tasks in Phase 2" — but no Phase 2 card lists it. Flagged, not built: it is a different
   user intention with a different warning, and quietly adding it here would hide the
   planning gap rather than close it.
3. **Theme overrides are the one thing the round trip does not restore.** Dropping them is
   card step 4's explicit instruction, and § 5 accepts it: an override's key namespace
   belongs to the template, so an override is presentation and not invitation data. Worth an
   ADR, because "no data loss" and "overrides are dropped" read as a contradiction until
   that distinction is stated.
