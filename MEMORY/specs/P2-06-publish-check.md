# P2-06 — Feature Spec: Publish-Check Endpoint and Editor Checklist

| | |
|---|---|
| **Task** | `P2-06` |
| **Date** | 2026-09-13 |
| **Author** | Claude Opus 5 |
| **Status** | Implemented |

**Honesty note on the timing.** `TASKS/` requires this document *before* implementation for
a `Spec required` task. It was written alongside the backend instead — the resolver already
existed from `P0-20`, and the work began as "wire up an existing rule". That turned out to
be wrong in one place: the template-change interaction (§ 8) is a business decision, it was
`OQ-23`, and it should have surfaced here rather than in the middle of writing a service.
It did get raised before being decided (ADR-061), so the rule that matters held; the
sequence did not.

---

## 1. Goal

A user editing an invitation can see, at any moment, exactly which required fields are
still empty and which section each belongs to — in Indonesian, never as a dot-notation
path — and a Publish button that is visible, disabled, and explains itself. The server
answers the same question at `GET /invitations/:id/publish-check`, and a published
invitation can no longer be moved onto a template whose required fields it does not
satisfy.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/API/04-INVITATION-API.md` | Endpoint table, line 109 | `GET /api/v1/invitations/:id/publish-check` — "check missing fields without actually publishing (used for a UI checklist indicator)". The path and the purpose; **no body shape** is given. |
| `docs/BACKEND/03-VALIDATION-STRATEGY.md` | § Validating Completeness for Publishing | The algorithm: for each **enabled** section, test each `required_fields` path against the invitation data. |
| `docs/PLAN/02-BUSINESS-RULES.md` | BR-4.2 | Required fields must be non-empty before an invitation may be published. |
| `docs/UI-UX/12-EDITOR-UX.md` | § Publish CTA | "disabled with a tooltip explaining why if a required field is empty (**not hidden** — the user should always know the button exists and understand why they can't click it yet)". |
| `docs/UI-UX/10-COMPONENT-LIBRARY.md` | § SectionListItem | The sidebar marks a section that is incomplete. |
| `docs/FRONTEND/03-STATE-MANAGEMENT.md` | § Validation | The client computes for immediacy; the server is authoritative. |
| `docs/FRONTEND/04-TEMPLATE-RENDERING.md` | § Render Flow step 2 | A `configurable: false` section is displayed whatever `enabled_sections` says. |
| `docs/API/00-API-STANDARDS.md` | § Envelope, § ErrorDetail | `{ success, data }`; `ErrorDetail` is `{ field, message }`. |
| `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` | § Object-Level Authorization | Query-level ownership; 404 for a non-owner. |

No two of these disagree. The one thing `docs/` does not give is the response body, which
§ 4 resolves from the card's step 2 rather than by invention.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-4.2 | Required fields must be non-empty before publishing | `packages/schema/src/resolver/completeness.ts` (`P0-20`), read by `PublishCheckService.check`, `ChangeTemplateService.change`, and `PublishCta` |
| BR-4.1 | A disabled section's data is not published | `isSectionEnabled` — the enablement test comes **first**, so a disabled section's required fields never block |
| BR-3.1 | An invitation stays on its locked template version | `findTemplateVersionFor` reads the invitation's own `template_version_id`, never the newest published one |

## 4. API Contract

- **Method and path**: `GET /api/v1/invitations/:id/publish-check`
- **Request schema**: none. A path parameter only; nothing is accepted from the client.
- **Success response** (`docs/API/00` envelope):

```json
{
  "success": true,
  "data": {
    "ready": false,
    "details": [
      { "field": "couple.bride.nickname", "message": "Nama panggilan mempelai wanita di bagian Mempelai" }
    ],
    "incomplete_sections": ["couple"]
  }
}
```

`details[]` is `ErrorDetail[]` — deliberately the **same array** `POST /publish` will
return in its 422 body (card step 2), so the editor has one rendering path for "here is
what is left" and "you cannot publish yet, here is why". Two renderings of one list is how
they drift.

`incomplete_sections` is the deduped set of section keys, for the sidebar's marks. The
resolver repeats a path that two enabled sections both require, and that repetition is
information (`P0-20`); `details[]` keeps it, `incomplete_sections` does not.

- **Error cases**: `404 NOT_FOUND` for an id the caller does not own, for one that does not
  exist, and for a soft-deleted one — indistinguishable, per `docs/SECURITY/05`. `401` with
  no or an expired access token.

A definition that cannot be read (no `template_version_id`, or a row that vanished) returns
`ready: true` with empty lists rather than an error: a server-side failure to read the
template is not the user's incompleteness, and presenting it as such would tell a couple to
go and fill in fields that are already filled.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `invitations` | Read | Ownership predicate and `template_version_id` |
| `invitation_people`, `invitation_events`, `invitation_settings`, `invitation_bank_accounts`, `invitation_media`, `invitation_gallery_photos` | Read | Via `loadAggregate` — the same aggregate the detail endpoint serves |
| `template_versions` | Read | `sections`, for the `required_fields` |

**Migration required: no.** Nothing is written. The endpoint is a pure read and is safe to
call repeatedly, which is what the editor's checklist does.

## 6. Authorization

- **Who may call this?** The invitation's owner, authenticated. Email verification is
  **not** required — `docs/API/01` gates verification at publish and checkout, not at
  drafting, and this endpoint neither publishes nor charges.
- **How is ownership enforced, and at which layer?** At the query, through the `P0-11`
  repository: `requireOwnership(() => repository.findOwned(id, scope))`, where `findOwned`
  carries `WHERE owner_id = :scope`. `loadAggregate` and `findTemplateVersionFor` each
  repeat the scope predicate rather than trusting the earlier check, per `docs/SECURITY/04`
  § Implementation Principles.
- **What does a non-owner receive?** `404`. Proven by `publish-check.itest.ts` §
  "ownership" and by the `P1-25` sweep, which now covers this endpoint as its 25th.
- **Nested ids?** None. One `:id`.
- **Admin path?** None.

## 7. Validation and Sanitization

- **Structural validation**: none needed — no body, and the `:id` is a uuid the repository
  parameterizes.
- **Business validation**: the completeness rule itself, in the service.
- **Free text sanitized before storage**: not applicable; nothing is stored. The strings
  this endpoint *returns* are labels from a frozen table in `@wi/schema`, not user data, so
  there is no user-controlled text in the response at all.
- **Not accepted from the client**: everything. In particular the section list and the
  enabled-sections list are read from the database, never from the request — accepting
  either would let a caller declare their own invitation complete.

## 8. State Transitions

The endpoint itself changes nothing. But the same rule now guards one transition that
previously escaped it:

**`published` → `published` (different template)**, via `POST /invitations/:id/change-template`.
`ChangeTemplateService` runs the same check against the **target** template's sections
before applying the change, and refuses with a 422
`TEMPLATE_WOULD_LEAVE_PUBLISHED_INVITATION_INCOMPLETE` carrying the same `details[]`.
Without it, a live page could be moved onto a template requiring a field the couple never
filled — published *and* incomplete, a state no endpoint can produce directly.

This was `OQ-23`, open since `P1-15`, and is decided in ADR-061 rather than here. A
**draft** is not checked: a draft is expected to be incomplete, and `POST /publish` is
where BR-4.2 applies to it.

## 9. Side Effects

None. No events, no jobs, no cache writes, no notifications. The template definition is
read through `P2-01`'s cache, which this endpoint does not invalidate.

## 10. Failure Modes

- **Database down** — the request fails with the standard 500. Fail closed is automatic:
  nothing is published on a failed check, because the check does not publish.
- **Redis down** — `P2-01`'s cache fails open to the database, so the check still answers.
- **Template row unreadable** — `ready: true`, as § 4 explains. This is the one deliberate
  fail-open, and it is safe because it is not the authoritative gate: `POST /publish`
  (`P3-09`) runs its own check and is where a publish is actually refused. A checklist that
  refused to load would block a user over a server fault; a checklist that says "nothing
  left" cannot let an incomplete invitation through, because it does not let anything
  through.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Reading another user's invitation through this id | `SECURITY/05` § 1 | 404, no body distinction | `publish-check.itest.ts` → "answers a non-owner with 404 and the owner with a result"; `idor-sweep.itest.ts` → "GET /invitations/:id/publish-check" |
| Using the checklist to learn whether an id exists | `SECURITY/05` § 1 | Identical 404 for missing and not-owned | `idor-sweep.itest.ts` (shared assertion across all cases) |
| Turning a section off to publish an invitation missing a mandatory field | BR-4.1 / BR-4.2 interaction | A `configurable: false` section's fields still block | `publish-check.itest.ts` → "still blocks on a NON-configurable section the settings omit"; `publish-cta.spec.tsx` → "still blocks on a NON-configurable section the enabled list omits" |
| Changing template to strand a live page on unsatisfiable requirements | ADR-061 / BR-4.2 | 422, change not applied | `change-template.itest.ts` → the OQ-23 group |
| A field path leaking into the interface | Card DoD 4 | Never rendered | `field-labels.spec.ts` → "contains no dot-notation path"; `publish-cta.spec.tsx` → "contains no dot-notation path anywhere in its markup" |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit | `field-labels.spec.ts` — every canonical path has a label, no orphan labels, every section named, no empty label, no path in any rendered sentence |
| Unit (frontend) | `publish-cta.spec.tsx` — button visible-and-disabled, enabled when complete, `aria-describedby` present and resolvable, dropped when ready, disabled section does not block, non-configurable section still blocks, count, no path in the markup, axe clean in both states. `editor-shell.spec.tsx` — `missingRequired` counting, including the disabled-section case |
| Integration | `publish-check.itest.ts` — the four DoD groups plus ownership. `change-template.itest.ts` — the ADR-061 group |
| Security | `idor-sweep.itest.ts` — the endpoint added to the `P1-25` matrix (25 endpoints × 4 cases) |
| E2E | None added. The editor's publish flow is `P3-15`; a Playwright test of a button that does not yet submit anything would assert its own fixture. |

## 13. Observability

Nothing new is logged — a read endpoint that logged every call would log one per keystroke's
worth of saved state. The template-change refusal is visible through the existing 422 and
through `invitation.template_changed_while_published`, whose message was reworded to say
what it now means.

What would show a break in production: a rise in `POST /publish` 422s **without** a
preceding `publish-check` returning `ready: false` would mean the two disagree, which is the
one failure this design exists to prevent. Worth an alert when `P3-09` lands.

## 14. Open Questions

- **`OQ-24`** — whether changing the template of a published invitation should also require
  a confirmation field, the way BR-6.2 requires one for a slug change. Raised, not decided;
  `P3-15` owns the screen.
- `docs/API/04` names the endpoint but gives no body. The shape in § 4 follows the card's
  step 2 and is now the contract; `docs/API/04` is amended in this task to carry it.
