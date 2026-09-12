# P2-04 — Per-section error boundaries

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-2-TEMPLATE-RENDERING-AND-PREVIEW.md` § P2-04 |
| **Phase** | Phase 2 |
| **Surface** | web-app, public-invite |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P2-04-error-boundaries` |
| **Status** | Completed |
| **Spec** | Not required by the card |

---

## What Changed

All three boundary levels `docs/FRONTEND/08` asks for, and the editor protection that
document is unusually specific about.

| Level | Where |
|---|---|
| Section | `SectionBoundary`, inside the renderer, one per section |
| Route | `error.tsx` in both frontends |
| App root | `global-error.tsx` in web-app |
| Editor preview | `PanelBoundary`, around the preview panel |
| Tests | renderer 91 → 99, web-app 214 → 221 |

## Why

`docs/FRONTEND/08` § Public Invitation states the stake plainly: *"RSVP/event info is the
most important function and must never disappear because another section broke."* A
corrupt gallery row taking down the page means a guest cannot find the venue or confirm
attendance — on a page hundreds of people open from a WhatsApp link, at a time nobody is
watching a dashboard.

## How

**Each section is wrapped individually**, inside its `<section>` element rather than
around it. A failed section therefore still leaves its element in the document, which
keeps the page structure stable and means a `data-section` query finds it either way.
There is a test that two failing galleries do not compound — one boundary around the whole
list would lose the event section to the first failure, and that assertion is what tells
the two designs apart.

**A failed section renders nothing, not an apology.** `docs/FRONTEND/08` allows "hidden or
shows a subtle placeholder". Hidden is right for a guest: somebody who never knew the
gallery existed is not served by being told it is broken, and an error box in the middle
of a wedding invitation is worse for the couple than a missing section. The caller may
pass a `fallback`, and the editor does — because there the person looking at the screen
**is** the person who needs to know.

**The editor's boundary is the expensive one.** On the public page a broken section costs
a guest some content. In the editor it costs the couple work they have already done:
without a boundary, one bad render unmounts the whole editor and takes the properties
panel, the dirty-field set and every unsaved keystroke with it. `P1-22` went to some
trouble to ensure a failed *save* never loses a keystroke; an unhandled render error loses
the same data by a different route, and no amount of care in the save path would have
helped.

**It announces politely.** `role="status"`, not `alert`: an assertive announcement would
cut across whatever the user is typing, which is the thing the boundary exists to protect.

**The report carries no section data.** `docs/FRONTEND/08` § Logging asks for context
"WITHOUT including sensitive data (bank account numbers, etc.)". The obvious thing to
attach to a render error is the props that caused it — and for this renderer those props
are sometimes exactly that. It reports the section key, the component name and the error;
`invitation_id` is the caller's to add, because this package has no concept of which
invitation it is showing and giving it one would be the first step to it behaving
differently for some of them.

## Files and Components Touched

| Path | Change |
|---|---|
| `packages/template-renderer/src/SectionBoundary.tsx` | **New** |
| `packages/template-renderer/src/TemplateRenderer.tsx` | wraps each section |
| `packages/template-renderer/src/types.ts` | `SectionErrorReport`, `onSectionError`, `sectionFallback` |
| `frontend/web-app/src/components/PanelBoundary.tsx` | **New** |
| `frontend/web-app/src/editor/EditorShell.tsx` | wraps the preview panel |
| `frontend/web-app/src/app/{error,global-error}.tsx` | **New** — route and app root |
| `frontend/public-invite/src/app/error.tsx` | **New** — route |
| `scripts/check-design-tokens.mjs` | two narrow exemptions, documented |
| Two new spec files | 13 tests |

## Decisions Made

| Decision | Rationale |
|---|---|
| Class components | React has no hook for `componentDidCatch`. The one place a class is not a style choice |
| The boundary sits **inside** the `<section>` | A failed section keeps its element, so the page structure and any `data-section` query stay stable |
| Nothing by default on the public page, a message in the editor | Different audiences: a guest cannot act on it, the couple can |
| `role="status"`, not `alert` | An assertive announcement interrupts typing — the thing being protected |
| No section data in the report | The props that caused a render error are sometimes bank account numbers (`docs/SECURITY/09`) |
| `invitation_id` is the caller's to attach | The renderer has no concept of which invitation it shows, and should not gain one |
| Route pages show no `error.message` or `digest` | An unhandled error's message can carry an internal path or an identifier; the detail belongs in error tracking, which has an audience who can act on it |
| `global-error.tsx` styles itself inline | It catches a failure in the root layout — the file that loads `globals.css` and `@wi/ui`. A boundary depending on what it exists to survive renders unstyled or throws again |
| `reset()` before a full reload | Re-renders the segment without a navigation, keeping the in-memory auth session (`P1-20`) rather than forcing a refresh round trip on a transient failure |

## Deviations from `docs/`

**None in behaviour.** One tooling change: `check-design-tokens.mjs` gained two
exemptions — `global-error.tsx` by filename, and the `public-invite` surface. Both are
cases where **no token exists to use**: the first cannot rely on the stylesheet it exists
to survive, and the second deliberately does not import `@wi/ui/tokens.css` because an
invitation's palette is per-template data (`CLAUDE.md`, `docs/PLAN/07`) and importing the
application's tokens there would give every wedding the dashboard's indigo. Verified
narrow: a hard-coded colour in `web-app/src/app/error.tsx` is still caught.

## Tests Added

13.

| Group | Cases |
|---|---|
| A section that throws | **the rest of the page renders, and RSVP is still there**; nothing shown for the failure; a caller's fallback honoured; **two failures do not compound** |
| Corrupt data | malformed `gallery.photos` leaves the event and RSVP sections working |
| The report | names the section and component; **carries no account number and no `accounts` key**; no handler required |
| The editor | the panel survives; it says the preview failed **and that edits are safe**; `role="status"`; **unsaved state intact after a crash**; the properties tab still switchable |
| The boundary alone | passes children through; reports to a caller |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| An error report leaks no sensitive field | `docs/FRONTEND/08` § Logging, `docs/SECURITY/09` | `"carries no section data, however sensitive the section was"` — asserts the serialised report contains neither the account number nor the word `accounts` |
| An error page discloses nothing about the infrastructure | `docs/DEVOPS/05`'s reasoning | No `error.message` and no `digest` rendered on any of the three pages |
| One section cannot take down the page | `docs/FRONTEND/08` | **Mutation**: the boundary removed from the renderer — **7 named tests fail**. And from the editor shell — **5 named tests fail** |
| The public error page does not confirm an invitation exists | — | It says "Undangan belum bisa ditampilkan" rather than naming the invitation; an expired or missing one is `not-found.tsx`'s (`P2-08`) and the two must not leak which is which |

## Abuse Cases Covered

- Corrupt stored data in one section used to blank an entire published invitation.
- An error report carrying a couple's bank account number into an error tracker.
- An error page disclosing an internal path or identifier to whoever is looking at the
  screen, or to anyone behind them.

## DoD Verification

- [x] **A section that throws does not blank the page; the corruption test proves it** —
      four tests, including the two-failure case, and a mutation that fails seven by name.
- [x] **A preview crash in the editor leaves the form and local state usable** — five
      tests, including the unsaved dirty-field set surviving, and a mutation that fails
      five by name.
- [x] **Error reports carry section context and no sensitive fields.**

## What Did Not Work

**1. My first attempt swapped a registry entry and could not.** `COMPONENT_REGISTRY` is
frozen, and `registry.spec.tsx` asserts it is — so that no application can register a
component the API does not know about. `Object.defineProperty` failed with "Cannot
redefine property", which is the design working exactly as intended. The throwing
component is now injected where the renderer *looks a name up*, leaving the frozen
registry untouched.

**2. A regex substitution mangled the spec file** and produced `explode("")` in five
places — a test that switched nothing and asserted the boundary worked. Rewritten with the
file-writing tool. Third time this session that assembling code through shell string
substitution has produced subtly wrong output, after a NUL byte in `P2-01` and a literal
backspace in `P2-03`. The pattern is clear enough to state as a rule: **code containing
escapes or regexes gets written, not substituted.**

**3. The editor test failed three times for three reasons that were all mine.** No
`AuthProvider`, so `EditorProvider` threw before the boundary was mounted — a failure that
looked like the boundary not working. Then the tab is labelled "Isian", not "Properti".
Then the store is created per-provider rather than as a module singleton (`P1-22`'s own
decision), so there was no global to inspect and it had to be read through the context.

**4. The state-survival test set its field inside the subtree that was about to throw.**
React discards that render, so the value never landed and the test failed with
`expected undefined to be 'Budi'` — which reads like the boundary losing state, the exact
opposite of what was happening. Restructured to the sequence that actually matters: the
couple types, **then** the preview crashes.

## Follow-Ups and Open Questions

- **Nothing sends these reports anywhere yet.** `onSectionError` and `PanelBoundary`'s
  `onError` are seams; `docs/FRONTEND/08` names Sentry and `docs/DEVOPS/05` has it in the
  stack. Wiring belongs with `P2-08` (server-side, where `invitation_id` is known) and
  `P2-05` (the editor). Until then a boundary catch is silent outside the console, which
  is the one part of this card's step 5 that is a seam rather than a shipped behaviour.
- **`public-invite` has no `global-error.tsx`.** Its root layout is a few lines and does
  not import a design system, so the route boundary covers the realistic failures. Worth
  adding with `P2-08`, when that layout starts doing something.
- **`not-found.tsx` does not exist on either surface.** `docs/UI-UX/14` § Special States
  wants a friendly page for an expired or unknown invitation, and that is `P2-08`'s —
  named here because the two pages must read as different situations without either
  leaking which one applies.
- **The API client's centralised interceptor** (`docs/FRONTEND/08` § Global Fetch Error
  Handling: 401 → refresh, 5xx → toast, network → offline indicator) is only partly
  there — `P1-20` built the 401 refresh. The 5xx toast and offline indicator are not, and
  belong with whichever card first has a surface to show them on.

## What to Watch

**A boundary makes a crash quiet.** That is the point and it is also the risk: a section
that fails for every invitation will now fail invisibly, forever, until somebody notices a
missing gallery. The seam above is what turns that from a silent degradation into an
alert, and it is not connected yet.

**`SectionBoundary` catches render errors, not asynchronous ones.** An error thrown in a
`setTimeout` or an unhandled promise rejection inside a section does not reach it — React
boundaries never see those. Phase 4's RSVP submission is the first thing that will have
one, and it needs its own handling rather than an assumption that this covers it.
