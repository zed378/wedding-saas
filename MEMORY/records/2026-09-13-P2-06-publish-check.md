# P2-06 — Publish-Check Endpoint and Editor Checklist

| | |
|---|---|
| **Task** | `P2-06` |
| **Date** | 2026-09-13 |
| **Branch** | `feat/P2-06-publish-check` |
| **Status** | DONE |
| **Spec** | [`MEMORY/specs/P2-06-publish-check.md`](../specs/P2-06-publish-check.md) |

---

## What changed

`GET /api/v1/invitations/:id/publish-check` now answers what is still missing before an
invitation can be published, and the editor shows the same thing without waiting for a
round trip: a count in the header, a per-section mark in the sidebar, and a Publish button
that is **visible, disabled, and says why**.

Alongside it, `OQ-23` was answered (ADR-061): a **published** invitation may still change
template, but the BR-4.2 required-field check now re-runs against the target template first
and refuses the change with a 422 rather than leaving a live page incomplete.

## Why

BR-4.2 says required fields must be non-empty before publishing. Until this task the rule
existed as a resolver (`P0-20`) with no caller: nothing evaluated it, and the editor had no
way to tell a couple what was left. `docs/UI-UX/12` is specific about the failure that
causes — *"not hidden — the user should always know the button exists and understand why
they can't click it yet"* — because a user who cannot find the Publish button does not
conclude their invitation is incomplete. They conclude the product cannot publish.

## How

**The rule is evaluated in exactly one place.** `collectMissingRequiredFields` from
`@wi/schema` is called by the service, by the change-template guard, and by the React
button. Not three implementations that agree today — one function, imported three times.
The single thing a client-side completeness check must never do is disagree with the server
about what is complete, and the only reliable way to guarantee that is to run the same code.
This is why the shared-package decision in ADR-004 was made, and it is the first task that
collects on it.

**Labels are a data table, not string formatting.** `packages/schema/src/invitation/field-labels.ts`
maps every canonical path to an Indonesian label and every section key to a section name.
`describeMissingField({sectionKey, path})` produces *"Nama panggilan mempelai wanita di
bagian Mempelai"*. A label says whose field it is, because the checklist is a flat list with
no section heading above it to lean on — the editor's own control can say just "Nama
panggilan"; this cannot.

**The enablement test comes first**, and that ordering is the whole of the card's first DoD
item. A couple who turned the gift section off has no account number and is **not**
incomplete; they made a choice. But a `configurable: false` section is displayed whatever
the settings say, so its required fields still apply — otherwise a settings row that omits
`hero` would be a way to publish an invitation with no names on it.

**One `details[]` shape.** The check, the change-template refusal and (when `P3-09` lands)
the publish 422 all return the same `ErrorDetail[]` through the shared `summarise()`. Three
endpoints can tell a user a field is missing; one rendering path means they cannot word it
three different ways.

## Files touched

**New**
- `packages/schema/src/invitation/field-labels.ts` — `FIELD_LABELS`, `SECTION_LABELS`, `fieldLabel()`, `sectionLabel()`, `describeMissingField()`
- `packages/schema/src/invitation/field-labels.spec.ts` — coverage in both directions
- `backend/api/src/modules/invitation/publish-check.service.ts` — `PublishCheckService`, `summarise()`
- `backend/api/test/integration/publish-check.itest.ts` — service-level and HTTP-level
- `frontend/web-app/src/editor/PublishCta.tsx`
- `frontend/web-app/test/publish-cta.spec.tsx`
- `MEMORY/specs/P2-06-publish-check.md`

**Modified**
- `packages/schema/src/index.ts` — exports the labels
- `backend/api/src/modules/invitation/invitation.controller.ts` — `@Get(":id/publish-check")`
- `backend/api/src/modules/invitation/invitation.module.ts` — registers the service
- `backend/api/src/modules/invitation/change-template.service.ts` — the ADR-061 guard; the `warn` message reworded
- `backend/api/test/integration/change-template.itest.ts` — four OQ-23 tests
- `backend/api/test/integration/idor-sweep.itest.ts` — the endpoint added to the `P1-25` matrix
- `backend/api/test/invitation-http.spec.ts` — the hand-wired module needs the new provider
- `frontend/web-app/src/editor/EditorShell.tsx` — the button in the header
- `frontend/web-app/src/editor/SectionListPanel.tsx` — `missingRequired` now delegates to the shared resolver; **signature changed**
- `frontend/web-app/test/editor-shell.spec.tsx`, `frontend/web-app/test/panel-boundary.spec.tsx` — updated for the above
- `docs/API/04-INVITATION-API.md` — the response shape, and the new 422
- `TASKS/BACKLOG.md`, `MEMORY/DECISIONS.md` (ADR-061), `TASKS/PROGRESS.md`, `TASKS/PHASE-2-*.md`, `MEMORY/CHANGELOG.md`, `MEMORY/MEMORY-INDEX.md`

## Decisions made

- **ADR-061** — a published invitation may change template, and the required-field check
  re-runs first. Closes `OQ-23`, raises `OQ-24`.
- `docs/API/04` named `publish-check` but gave no body. The shape now documented follows the
  card's step 2 (identical to the publish 422's `details[]`) rather than being invented.
  Amended in this task, per `CLAUDE.md` § When docs and reality disagree.

## Deviations from `docs/`

None in behaviour. Two amendments to `docs/API/04`, both additive: the `publish-check`
response body, and `TEMPLATE_WOULD_LEAVE_PUBLISHED_INVITATION_INCOMPLETE` on
`change-template`.

## Tests added

| File | Count | What it proves |
|---|---|---|
| `packages/schema/src/invitation/field-labels.spec.ts` | 9 | Every canonical path has a label and every label a path; no section unnamed; **no dot-notation path appears in any of the 240 path x section sentences the product can produce** (24 fields x 10 sections) |
| `backend/api/test/integration/publish-check.itest.ts` | 10 | The four DoD groups; ownership at the service; the envelope and a 404 over real HTTP |
| `backend/api/test/integration/change-template.itest.ts` | +4 (31 total) | ADR-061: a published invitation is refused, a draft is not, the data is untouched after a refusal, the `details[]` carry labels |
| `frontend/web-app/test/publish-cta.spec.tsx` | 11 | Visible-and-disabled; enabled when complete; `aria-describedby` resolvable and dropped when ready; a disabled section does not block; a non-configurable one still does; no path in the markup; axe clean in both states |
| `frontend/web-app/test/editor-shell.spec.tsx` | +2 | `missingRequired` under the new signature, including both enablement cases |
| `backend/api/test/integration/idor-sweep.itest.ts` | +1 endpoint | The `P1-25` matrix is now 25 endpoints |

Totals after: API integration **811**, API unit **544**, web-app **246**, schema **109**.
`pnpm verify` green.

## Security verification

Named tests, per `MEMORY/README.md`'s honesty rule:

- **Object-level authorization** — `publish-check.itest.ts` → *"answers a non-owner with 404
  and the owner with a result"* (service, via `expectIdorSafe`) and *"gives a stranger a 404
  with no trace of the invitation"* (HTTP, asserting the id is absent from the body).
  `idor-sweep.itest.ts` → row `GET /invitations/:id/publish-check`, regenerated matrix:
  non-owner **404**, owner **200**.
- **Enforced at the query, not after the fetch** — `findOwned`, `loadAggregate` and
  `findTemplateVersionFor` each carry the `owner_id` predicate; `check-tenant-scope` passes.
- **Nothing accepted from the client** — the endpoint has no body and no query parameters.
  The section list and enabled-sections list are read from the database; a caller cannot
  declare their own invitation complete.
- **Nothing sensitive logged** — the endpoint logs nothing of its own beyond the standard
  request line.

**Mutation-tested**, each mutation reverted after the run:

| Mutation | Test that failed |
|---|---|
| `disabled={!ready}` → `disabled={false}` | *"is in the document and disabled while a required field is empty"*, *"still blocks on a NON-configurable section the enabled list omits"* |
| `{describeMissingField(item)}` → `{item.path}` | *"names each missing field in Indonesian, with its section"*, *"contains no dot-notation path anywhere in its markup"*, *"explains itself to a screen reader while disabled"* |
| enablement ignored (every section treated as on) | *"does not hold publishing back over a field it would have required"* |

## Abuse cases covered

| Abuse case | Expected | Test |
|---|---|---|
| Reading another tenant's invitation through this id | 404, no data | `publish-check.itest.ts`, `idor-sweep.itest.ts` |
| Using the checklist as an existence oracle | Identical 404 | `idor-sweep.itest.ts` |
| Disabling a mandatory section to publish without its fields | Still blocked | *"still blocks on a NON-configurable section the settings omit"* |
| Changing template to strand a live page on unsatisfiable requirements | 422, unchanged | `change-template.itest.ts`, the OQ-23 group |
| A field path reaching the interface | Never rendered | `field-labels.spec.ts`, `publish-cta.spec.tsx` |

## Definition of Done

**Card**

- [x] A required field inside a disabled section does not block publishing — `publish-check.itest.ts` → *"is ready once the gift section is turned off"*, and `publish-cta.spec.tsx` → *"does not hold publishing back over a field it would have required"*.
- [x] `details[]` matches the publish endpoint's 422 body — one `summarise()` produces both; `docs/API/04` now says so.
- [x] Per-section incompleteness, and the Publish button never hidden — `SectionListPanel` marks, `publish-cta.spec.tsx` → *"is in the document and disabled…"*.
- [x] Field paths never reach the interface untranslated — asserted exhaustively in `field-labels.spec.ts` and over the rendered markup in `publish-cta.spec.tsx`.

**Global**

1. [x] Tests at the right layer — unit for the labels, integration against real Postgres/Redis, component tests for the button. No E2E: the button does not submit anything until `P3-15`, and a Playwright test of it would assert its own fixture.
2. [x] IDOR test on the `:id` endpoint — named above.
3. [x] Every abuse case has a test — table above.
4. [x] Field whitelisting — not applicable; the endpoint accepts nothing. The change-template guard reads the template from the database, never from the body.
5. [x] Sanitization — not applicable; nothing is stored. Every string returned is a frozen label, not user data.
6. [x] Envelope asserted — `publish-check.itest.ts` → *"answers inside the `docs/API/00` envelope and nothing else"*, using the `P0-13` shared helper.
7. [x] State transitions logged — no transition happens here. The change-template refusal happens *before* any write, so there is no state to log; the existing `warn` covers the allowed case.
8. [x] Nothing sensitive logged.
9. [ ] **CI green — waived, as on every task so far.** There is no pipeline; `P0-17` is deferred by ADR-028. `pnpm verify` passes locally, plus the integration suite, which `verify` does not run.
10. [x] This record, the index, the changelog, ADR-061.
11. [x] `PROGRESS.md` and the phase checkbox, in this commit.

## What did not work

**The spec was written alongside the code, not before it.** The card says `Spec required:
Yes`. The work began as "wire up a resolver that already exists", which felt like plumbing —
and then hit `OQ-23`, which is a product decision about live invitations and guests. Writing
§ 8 of the spec first would have surfaced it before a service was half-written. The rule
that mattered held (it was raised as an ADR, not decided silently), but the sequence did not,
and it is recorded here rather than tidied away.

**A defensive default that hid a broken fixture.** `panel-boundary.spec.tsx`'s
`DEFINITION` had no `enabledSections`, so five tests began throwing inside the resolver as
soon as the button joined the header. The first fix was `definition.enabledSections ?? []`
in two components. That was wrong: the type declares the field **required**, the store fills
it in on every path, and the `??` would have made any future fixture with the same hole pass
silently. Reverted; the fixture was fixed instead.

**A hand-wired Nest test module.** `invitation-http.spec.ts` builds the controller from
stubs rather than booting `AppModule`, so the new constructor dependency failed there and
nowhere else — after the integration suite was already green. Worth knowing for every future
service added to `InvitationController`: that file needs a stub, and the failure message
names the missing provider clearly.

## Follow-ups

- **`OQ-24`** — whether a template change on a published invitation should require a
  confirmation field, as BR-6.2 requires for a slug. `P3-15` owns the screen.
- **`P3-09`** must call this same resolver for its 422, not a second implementation. The
  shape is already fixed by `docs/API/04`.
- **`P3-15`** should surface the count in the publish flow, and can reuse `PublishCta`.
- The editor evaluates the checklist against **local** state, which includes edits not yet
  saved. That is deliberate (`docs/FRONTEND/03` § Validation) and means the button can
  enable a moment before the server would agree. `POST /publish` is authoritative and will
  refuse; the user sees a 422 they can act on rather than a silently wrong success.

## What to watch in production

- **A `POST /publish` 422 that no `publish-check` predicted** is the one failure this design
  exists to prevent — it would mean client and server disagree about completeness despite
  running the same function, which in practice means the client's data snapshot is stale.
  Worth an alert once `P3-09` ships.
- **`TEMPLATE_WOULD_LEAVE_PUBLISHED_INVITATION_INCOMPLETE` appearing often** would mean
  couples are hitting a refusal where they expect a template gallery to work. The rule is
  right; the place it is enforced might want to move earlier, into the gallery's preview.
- **`invitation.template_changed_while_published`** still fires on every allowed change. Its
  message was reworded because half of what it used to warn about is no longer true, and a
  log line describing a risk that no longer exists is how a real one stops being read.
