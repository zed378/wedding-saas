# P1-21 — Frontend: dashboard and creation wizard

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-21 |
| **Phase** | Phase 1 |
| **Surface** | web-app, **and backend** — see Deviations |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-21-dashboard` |
| **Status** | Completed |
| **Spec** | Not required by the card; written into this record |

---

## What Changed

`/dashboard` with a filterable invitation list and two guided empty states, `/dashboard/new`
with the two-step creation wizard, and the `(app)` route group that puts `RequireAuth` around
everything under it.

And a backend endpoint the card did not ask for and its DoD could not be met without:
`GET /invitations/slug-available`.

## Why

`docs/PLAN/04` § F2, `docs/UI-UX/10` § InvitationCard, `docs/UI-UX/04`'s organiser journey,
`docs/UI-UX/01` principle 7, `docs/UI-UX/15`.

## How

**The badge is not rendered here.** `InvitationStatusBadge` from `@wi/ui` owns the colour and
the label, which is what card DoD 1 asks for. The test asserts the *label* and reads it back
out of `INVITATION_STATUS_PRESENTATION` rather than restating it — so a card that rendered its
own badge would have to duplicate the label too, and the assertion fails the moment the two
diverge.

**Two empty states, because the two situations need opposite advice.** A user with no
invitations needs to create one; a user whose *filter* matched nothing needs the filter
cleared. Showing the first message to the second tells somebody with twelve invitations to
create their first.

**Filtering goes through the query, not the browser.** `docs/UI-UX/04`'s organiser has many
invitations, and filtering client-side would mean fetching all of them to show five. The
abort in the effect is what stops a slow answer for an old filter painting over a fast answer
for the current one.

**The address is shown only once published.** A slug exists before publishing — the wizard
sets one — but the page is not there. Showing the address would invite the couple to share a
link that 404s.

**The availability check is advisory and the create call is authoritative** (ADR-057). The
wizard shows the check while the user types **and** handles 409 `SLUG_TAKEN` on submit, with
the field marked and the user's work intact. That second path has its own test.

**The local slug rules mirror the server's format and deliberately not its blocklist.** The
blocklist is a table an admin edits without a deploy (`docs/SECURITY/10`), so a copy in the
frontend would be wrong the first time somebody added a word. A test asserts `admin` passes
the local check — it is the server's job to refuse it.

**The address is suggested from the name until the user edits it.** After that the field is
theirs: overwriting a deliberate choice on every keystroke of a different field is the kind of
helpfulness people hate.

## Files and Components Touched

| Path | Change |
|---|---|
| `frontend/web-app/src/lib/invitations.ts` | **New** — the API surface, the local slug mirror, `suggestSlug` |
| `frontend/web-app/src/components/InvitationCard.tsx` | **New** |
| `frontend/web-app/src/components/InvitationList.tsx` | **New** — filter, empty states, load states |
| `frontend/web-app/src/components/CreateWizard.tsx` | **New** |
| `frontend/web-app/src/app/(app)/layout.tsx` | **New** — `RequireAuth` around the group |
| `frontend/web-app/src/app/(app)/dashboard/page.tsx`, `new/page.tsx` | **New** |
| `backend/api/src/modules/invitation/invitation.controller.ts` | **`GET /invitations/slug-available`**, declared above `:id` |
| `backend/api/src/shared/sanitizer/registry.ts` | `exclude_invitation_id` |
| `docs/API/04-INVITATION-API.md` | **Amended** — the endpoint and its advisory contract |
| `MEMORY/DECISIONS.md` | ADR-057 |
| `TASKS/BACKLOG.md` | PG-18 |
| `frontend/web-app/test/dashboard.spec.tsx` | **New** — 36 tests |
| `backend/api/test/invitation-http.spec.ts` | 10 tests added |
| `e2e/tests/auth-screens.e2e.ts` | 4 mobile-layout checks |

## Decisions Made

| Decision | Rationale |
|---|---|
| **`slug-available` is advisory** (ADR-057) | It cannot reserve anything; a reservation would need a lock held across a user's typing, an expiry, and a release for one abandoned mid-wizard |
| It is authenticated and rate limited | A slug is public; the endpoint is a yes/no oracle over every published address, and harvesting should not be convenient |
| The three `reason` kinds stay distinct | "Not a valid address", "reserved" and "taken" are different problems for the person typing |
| `RequireAuth` wraps the **route group** | A page added under `(app)/` is protected by existing rather than by somebody remembering a wrapper |
| The blocklist is not mirrored client-side | It changes without a deploy |
| Actions use `aria-label`, not a hidden span | An accessible name assembled from sibling text nodes is joined without a separator by some implementations — jsdom produces `"EditRina & Joko"` |
| The filter row is a `radiogroup` | Exactly one is active, which is what the role means, and it gets arrow-key navigation from the platform |
| The template list is empty until `P2-01` | A hard-coded list would be a fixture somebody later has to find and remove |

## Deviations from `docs/`

**`docs/API/04` amended and a backend endpoint added from a card marked `Surface: web-app`.**
The DoD requires availability to be checked before submission and nothing existed to check
with: creation and settings both discover a collision by *failing*, which is right for them
and poor for somebody typing into a wizard. `P1-09`'s `SlugService.check` already answered the
question; only the route was missing. Recorded as PG-18 and ADR-057, and the card's surface
label is wrong rather than the work being out of scope.

## Tests Added

50 (36 component, 10 HTTP, 4 browser). Web-app 56 → 92; API unit 538 → 548.

| Group | Cases |
|---|---|
| The badge | the label comes from `@wi/ui`'s map; all five statuses through it |
| The card | the address appears only once published; **every action names its invitation**; `noreferrer` on the cross-origin link; a placeholder rather than a broken image |
| The list | lists what the API returned; **filters through the query**; a radiogroup with exactly one active; **two different empty states**; a failed load is an error, not an empty dashboard; no axe violations |
| The slug mirror | six local rejections; what the server accepts; silence on an empty field; **the blocklist is not mirrored**; suggestions including an accented letter |
| The wizard | the template step shows, and is **skipped** when one arrived from the catalogue; the suggestion stops once the user edits; **availability is checked before submission**; **no request for an address the local rules already reject**; **the server still wins on a 409**; the new id reaches the caller; no axe violations on either step |
| HTTP | available; **both rejection reasons**; four shape rejections; 401; 429; **not swallowed by the `:id` route** |
| Browser | three routes at 360px with no sideways scroll; **every tap target at least 44px** |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| `slug-available` needs a session | ADR-057 | `"is 401 without a token"` |
| It is rate limited | `SECURITY/10` | `"is rate limited"` |
| Every route under `(app)` is guarded | `FRONTEND/01` | `RequireAuth` wraps the group layout; `P1-20`'s guard tests cover its behaviour |
| The dashboard URL does not reach the public invitation | `SECURITY/09` | `"does not leak the dashboard URL to the public invitation"` — `rel="noreferrer"` |
| The advisory check cannot be mistaken for a promise | ADR-057 | `"the server still wins when it says the address is taken"` |

## DoD Verification

- [x] Status badge colours come from the design system map, not local conditionals.
- [x] Slug availability is checked before submission and the server result still wins on
      conflict. Both halves have a test, and the second one asserts the user's work survives.
- [x] The wizard runs once and does not reappear on subsequent edits. It redirects with
      `replace`, nothing links back into it from an existing invitation, and there is no
      re-entry path.
- [x] The dashboard is usable at 360px. Measured in a browser as "the document does not
      scroll sideways", plus a tap-target check — `docs/UI-UX/15` and WCAG 2.5.5.

## What Did Not Work

**1. `@Get("slug-available")` was swallowed by `@Get(":id")`.** Nest matches routes in
declaration order, so a parameterised route declared first captures every literal sibling:
`/invitations/slug-available` became a lookup for the invitation whose id is
`"slug-available"` and answered 404 — which reads as a missing endpoint rather than a routing
mistake. Eight tests caught it at once. The fix is positional and therefore easy to undo by
moving a method, so there is a test named `"is not swallowed by the :id route"` that asserts
the response shape rather than only the status.

**2. The accessible name of an action was `"EditRina & Joko"`.** `Edit<span class="sr-only">
{name}</span>` renders correctly and computes to a name with no separator in jsdom — accname
implementations differ on whether to insert one, and the specification does not require it.
Replaced with `aria-label`, which is deterministic and still satisfies WCAG 2.5.3 Label in
Name because the label starts with the visible text.

**3. The browser suite failed nine tests against a stale server.** A `next start` had failed
silently because the port was still held by an earlier instance, so Playwright was auditing a
build without `/dashboard` in it. Worth noting because the symptom — a run that was green
twenty minutes earlier failing everywhere — looks like a code regression for a while.

**4. The card is labelled `Surface: web-app` and required a backend change.** Not a mistake
in the work; a mistake in the card. The DoD cannot be met from the frontend alone.

## Follow-Ups and Open Questions

- **The template list is empty.** `P2-01` builds the catalogue API and `P2-11` its UI; until
  then the wizard's first step shows "no templates available" and only the `?template=` path
  is usable. Honest, and it means the wizard cannot actually be completed from the dashboard
  yet.
- **`/editor/:id` does not exist**, so the wizard's redirect lands on a 404. `P1-22` builds it.
- **Delete is not wired.** `InvitationCard` accepts `onDelete` and the list does not pass one;
  the endpoint exists (`P1-10`) but a destructive action needs the confirmation modal that
  `docs/UI-UX/05` specifies, which belongs with the editor work.
- **Pagination is read and ignored.** `listInvitations` returns `page`/`total` and the list
  renders the first page only. Fine at the current scale; the organiser journey will want it.

## What to Watch

**Route ordering in `invitation.controller.ts` is now load-bearing.** `slug-available` must
stay above `:id`, and `gallery/reorder` is a `POST` so it is safe today — but a future
`GET /invitations/:id/gallery/reorder` would have the same problem. Nest gives no warning.

**The local slug mirror will drift.** `SLUG_FORMAT` is written twice, once in
`backend/api/src/modules/invitation/slug.service.ts` and once in
`frontend/web-app/src/lib/invitations.ts`. It is a mirror on purpose — the frontend cannot
import from the backend — and the failure mode is mild: the server still refuses what the
mirror missed. But if the format ever changes, both change.
