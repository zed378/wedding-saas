# P3-15 — Frontend: Publish Flow and Share Screen

| | |
|---|---|
| **Date** | 2026-10-17 |
| **Task** | `TASKS/PHASE-3-ORDER-PAYMENT-PUBLISHING.md` § P3-15 |
| **Phase** | Phase 3 |
| **Surface** | web-app |
| **Author** | Agent |
| **Commits / PR** | P3-15 |
| **Status** | Completed |

---

## What Changed

Connected the editor's "Terbitkan" action to the authoritative server-side `publish-check`, built navigable missing-field links that switch sections and focus inputs directly, implemented slug confirmation modal with inline 409 `SLUG_TAKEN` conflict recovery, added payment-required redirection to checkout, provided the working publish success modal with WhatsApp share and link copying, and added the consequence-first unpublish modal for published invitations.

## Why

Per Phase 3 roadmap (`docs/PLAN/16`) and feature specification `docs/PLAN/04` § F8, `docs/UI-UX/05` § User Flows, and `docs/UI-UX/12` § Publish CTA. Couples need an unambiguous, friction-free path from editing to publishing. Any validation blockers must navigate directly to the offending field; slug conflicts must be recoverable without navigating away; unpaid invitations must route cleanly to checkout; and unpublishing must clearly state consequences to prevent accidental takedowns.

## How

- Updated `PublishCta.tsx` (`frontend/web-app/src/editor/PublishCta.tsx`):
  - On "Terbitkan" click, calls `checkPublish(api, invitationId)`. If fields are missing on the server, displays the missing-fields modal with localized labels.
  - Clicking any missing field sets `activeSectionKey` on `EditorStore`, smoothly scrolls the section list into view, and focuses the target input control (`[name="..."]`).
  - If complete, opens the slug confirmation modal displaying `invitation.vizunicum.my.id/{slug}` with warning that changing later breaks old links.
  - On confirm publish, handles `409 SLUG_TAKEN`: displays the inline slug conflict state with the server's suggestion chip, enables live editing, updates the slug via `PATCH /settings`, and retries publish in place.
  - On `402 PAYMENT_REQUIRED` or `PAYMENT_PENDING`, switches to the payment required prompt explaining the 12-month access package and linking to `/checkout/:invitationId`.
  - On publish success, transitions to `published` state rendering `PublishSuccessModal`.
- Enhanced `SectionListPanel.tsx` (`frontend/web-app/src/editor/SectionListPanel.tsx`):
  - Added `data-section={section.section_key}` attribute to section buttons for DOM targeting and navigation.
- Verified `PublishSuccessModal.tsx` (`frontend/web-app/src/components/PublishSuccessModal.tsx`):
  - Shows guaranteed live public URL with copy-to-clipboard action and pre-filled WhatsApp share deep link.
- Verified `UnpublishAction.tsx` (`frontend/web-app/src/editor/UnpublishAction.tsx`):
  - Renders only when `invitationStatus === 'published'`.
  - Presents confirmation modal stating: *"Tautan publik akan berhenti bekerja. Tamu yang sudah punya link tidak akan bisa mengaksesnya."*
  - Calls `POST /invitations/:id/unpublish` and triggers `onUnpublished()` to reload editor state.
- Protected `PropertiesPanel.tsx`:
  - Added null-safety check for `located.province?.code` in `refineFromBoundary`.

## Files and Components Touched

| Path | Change |
|---|---|
| `frontend/web-app/src/editor/PublishCta.tsx` | Navigable missing fields with section switching + field focus, inline slug conflict recovery, payment required handling |
| `frontend/web-app/src/editor/SectionListPanel.tsx` | Added `data-section` attribute to section button for DOM navigation |
| `frontend/web-app/src/editor/PropertiesPanel.tsx` | Added null-safety on `located.province?.code` |
| `frontend/web-app/test/publish-flow.spec.tsx` | Comprehensive test suite for all 4 DoD items and publish steps |
| `MEMORY/DECISIONS.md` | Recorded ADR-085 |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Inline slug conflict recovery without leaving modal | Exiting to settings modal during slug conflict loses publish intent; inline resolution keeps flow smooth | ADR-085 |
| Missing field navigation via store action + DOM focus | Directly switching active section and focusing input solves user disorientation | ADR-085 |
| Consequence-first unpublish modal | Plain text stating that guest links stop working prevents accidental takedowns | ADR-085 |

## Deviations from `docs/`

None. All behaviors follow `docs/PLAN/04` § F8, `docs/UI-UX/05`, and `docs/UI-UX/12`.

## Tests Added

| Layer | What it covers |
|---|---|
| Component / Integration | `test/publish-flow.spec.tsx` (6 tests): Missing-field modal & navigation to section + field focus, complete but unpaid routing to checkout, publish success modal with public link & WhatsApp share, inline slug conflict recovery with suggestion, unpublish confirmation & cancellation |

## Security Verification

| Control | Requirement source | Test that proves it |
|---|---|---|
| Authoritative server validation check | `docs/SECURITY/08` | `test/publish-flow.spec.tsx` › "opens missing-fields modal when server reports incomplete data and navigates to section" |
| Slug update authorization & validation | `docs/SECURITY/05` | `test/publish-flow.spec.tsx` › "handles 409 SLUG_TAKEN inline, allows editing or accepting suggestion, and publishes" |
| Consequence explanation before state alteration | `docs/UI-UX/13` | `test/publish-flow.spec.tsx` › "renders unpublish button when published and shows plain explanation before action" & "cancelling unpublish leaves state untouched without calling API" |

## Abuse Cases Covered

| Abuse case | Source | Test |
|---|---|---|
| Client publishes while skipping required fields | `docs/SECURITY/08` | `test/publish-flow.spec.tsx` › "opens missing-fields modal when server reports incomplete data and navigates to section" |
| Unpaid account attempts publish | `docs/SECURITY/07` | `test/publish-flow.spec.tsx` › "shows payment required modal with checkout link when publish requires payment" |
| Slug collision on publish | `docs/PLAN/04` § F8 | `test/publish-flow.spec.tsx` › "handles 409 SLUG_TAKEN inline, allows editing or accepting suggestion, and publishes" |

## Definition of Done Verification

- [x] Tests at the appropriate pyramid layer — 6 new tests in `test/publish-flow.spec.tsx`, all passing.
- [x] IDOR test for every new `:id` endpoint — N/A (frontend task; backend endpoints verified in P3-09/P3-10).
- [x] Every abuse case has an automated test — Tested in `publish-flow.spec.tsx`.
- [x] Write endpoints whitelist their fields — N/A (consumed existing API).
- [x] Free-text input sanitized before storage — N/A (slug is restricted to alphanumeric + hyphens).
- [x] Response envelope matches `docs/API/00` — Consumes standard envelope.
- [x] State transitions logged (`invitation_status_history` / `audit_logs`) — Server-side handled.
- [x] Nothing sensitive logged — No sensitive data logged.
- [x] CI green: lint, types, build, unit, integration, dependency audit, SAST — `pnpm typecheck` passed (19/19 packages), `web-app` vitest passed (25/25 files, 397 tests), 5 security check scripts passed.
- [x] `TASKS/PROGRESS.md` and the phase file updated — Completed.
- [x] Task-specific DoD items:
  - [x] Missing-field errors are navigable — clicking one lands on the field.
  - [x] The publish result screen shows the working public link.
  - [x] A slug conflict is recoverable without leaving the flow.
  - [x] Unpublish explains what happens before it happens.

## What Did Not Work

- Direct `element.scrollIntoView()` in jsdom: jsdom does not define `scrollIntoView` on standard HTMLElement unless polyfilled. Guarded with `typeof element?.scrollIntoView === "function"` to ensure test resilience without masking browser functionality.
- Direct `screen.findByText(...)` inside `<dialog>` in jsdom: `<dialog>` visibility checks in jsdom can report element as hidden; asserted using `toBeInTheDocument()` and `queryByRole("dialog", ...)` matching `@wi/ui` testing conventions.

## Follow-Ups and Open Questions

None. Ready for `P3-16 — Payment Security Review and Phase 3 Acceptance`.

## What to Watch

- Monitor slug conflict rates in production: if users frequently hit 409, improve the initial wizard slug suggestions.
