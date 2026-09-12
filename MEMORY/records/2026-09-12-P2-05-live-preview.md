# P2-05 — Live preview in the editor

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-2-TEMPLATE-RENDERING-AND-PREVIEW.md` § P2-05 |
| **Phase** | Phase 2 |
| **Surface** | web-app, backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P2-05-live-preview` |
| **Status** | Completed |
| **Spec** | Not required by the card |

---

## What Changed

The editor renders a real invitation through the same renderer the public page uses — and
to get there, the backend gap that made it impossible had to be closed first.

| | |
|---|---|
| `LivePreview` | `TemplateRenderer` in `live` mode, device toggle, scroll-to-section, skip link |
| `EditorScreen` | fetches the **locked** template version's definition |
| Invitation detail API | `template: { slug, name, version }` — `PG-19`, ADR-060 |
| `EditorShell` | **a real bug fixed**: the three-column desktop layout never worked |
| Tests | web-app 233, plus 2 browser tests that close DF-11 |

## Why

The card's goal, and the thing the editor has been missing since `P1-22`: a preview that
renders from local state. `P1-23`'s properties panel was already a loop over a section
list it had no source for.

## How

**The gap first.** The editor needs the definition of the version its invitation is locked
to, and there was no way to get it: the detail response carried `template_id` and
`template_version_id` as bare uuids, while every catalogue endpoint is addressed by slug
and semver — and `GET /templates/:slug` serves the *newest* published version, which BR-3.1
makes the one answer certain to be wrong for an existing invitation. Raised as `PG-19`,
resolved by ADR-060: the detail gains `template: { slug, name, version }`, which are
exactly the arguments of `GET /templates/:slug/versions/:version`. Not the definition
itself — that would put kilobytes on every invitation read and duplicate `P2-01`'s cache.

**Local state, no refetch.** `docs/FRONTEND/06` § Why Not Fetch-on-Every-Keystroke is why
the 300ms budget is achievable: the preview is a function of the store, so a keystroke
reaches it in a render. The test asserts **both** halves — the elapsed time and that no
request was made — because a test measuring only time would pass against a fetch served by
a fast local mock, which is the implementation that document rules out.

**A failed definition fetch does not fail the editor.** It is fetched separately and its
error is swallowed: the properties panel still saves, and only the preview and section
list are unavailable. `definition: undefined` was already a state the editor handled.

**Scroll-to-section goes through `data-section`**, which the renderer already emits, rather
than a ref map — so it works for any template without the renderer knowing the editor
exists. `scrollIntoView` is feature-tested, because it is absent in jsdom and a throw there
would take the whole panel down through `P2-04`'s boundary.

## Files and Components Touched

| Path | Change |
|---|---|
| `frontend/web-app/src/editor/LivePreview.tsx` | **New** |
| `frontend/web-app/src/editor/EditorScreen.tsx` | definition fetch, preview mounted |
| `frontend/web-app/src/editor/EditorShell.tsx` | **the layout fix**, plus the skip-link target |
| `frontend/web-app/src/editor/store.ts` | `component`, `max_items`, `layout_variant`, `theme` |
| `frontend/web-app/src/app/workbench/editor-layout-story.tsx` | **New** — DF-11's browser fixture |
| `e2e/tests/workbench.e2e.ts` | 2 tests — DF-11 |
| `backend/api/src/.../invitation-repository.ts`, `.dto.ts`, `.service.ts` | `PG-19` |
| `packages/ui/src/tokens.css` | `--container-device-mobile` |
| `docs/API/04`, `MEMORY/DECISIONS.md`, `TASKS/BACKLOG.md` | ADR-060, `PG-19` |

## Decisions Made

| Decision | Rationale |
|---|---|
| Two requests, not an inlined definition | Different cache lifetimes: a definition changes a few times a year, an invitation on every keystroke |
| The definition fetch fails soft | The editor is still an editor without a preview; it is not without a form |
| `data-section` for scrolling | No coupling between the renderer and the editor |
| `aria-pressed` on the device toggle | Two states of one control, not a form the user did not open |
| Mobile frame by default | `docs/UI-UX/14` makes the public page "purely mobile-first"; defaulting to desktop previews the less common case |
| Desktop is unconstrained rather than transform-scaled | The panel is already narrower than a desktop viewport, so a scaled "real" desktop previews a size nobody uses |
| 375px as a token | A device width is a measurement somebody might change, and the guard was right to refuse it inline |
| DF-11 discharged on the workbench, not at `/editor/:id` | Reaching that route needs a session, an invitation and a published template; DF-11's actual question is a CSS one about the shell |

## Deviations from `docs/`

**`docs/API/04` amended** for `template` — ADR-060, raised as `PG-19` first rather than
decided while coding.

## Tests Added

19 in web-app (214 → 233), 2 in the browser, 1 in the API integration suite.

| Group | Cases |
|---|---|
| Renders from local state | the enabled sections of the locked version; `live` mode; **a missing definition says so** |
| **The budget** | **under 300ms and no request**; does not wait for autosave; a section switched off disappears **and its account number leaves the page source** |
| Device toggle | mobile default, `aria-pressed`; the frame switches |
| Scroll | the right element is asked to scroll |
| Skip link | points at the properties panel; **first in the tab order** |
| **Parity** | the preview and the public page produce **identical markup** for identical data |
| **DF-11, in a browser** | three panels side by side at 1280px, **left-to-right order asserted**; collapsed at 390px, with an attachment check so it cannot pass vacuously |
| API | `template` is in the detail shape and carries the locked version |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| A disabled section's data never reaches the preview's DOM | Card DoD via `P2-02` | `"reflects a section being switched off"` searches `innerHTML` for the account number |
| The template identity read is owner-scoped | `docs/SECURITY/05` | `findTemplateIdentity` repeats `owner_id = :scope` even though `detail` has already checked — a second code path reaching it would otherwise learn which template another user's invitation uses |
| The preview cannot submit anything | `docs/FRONTEND/04` | `mode="live"` asserted, and `P2-03`'s copy button is disabled outside `public` |

## DoD Verification

- [x] **A keystroke reaches the preview in under 300ms with no network request** — both
      halves in one test.
- [x] **Device toggle and scroll-to-section work.**
- [x] **The preview is skippable by keyboard** — and the link is first in the tab order,
      which is the part that makes it useful.
- [x] **Preview and public page render through the same component code** — a diff test
      asserting identical markup.
- [x] **DF-11** — two browser tests at two viewports. See below: it found a real bug.

## What Did Not Work

**1. DF-11 found the bug it was raised to look for.** `P1-22` wrote `hidden={!active}` with
`md:block` to restore a panel above the breakpoint. Tailwind v4's preflight contains:

```css
[hidden]:where(:not([hidden=until-found])) { display: none !important }
```

so **every inactive panel stayed hidden at every width and the three-column desktop layout
never worked**. Nothing caught it because jsdom evaluates no media queries — exactly the
gap `P1-22` recorded and DF-11 was raised to close. The card note said "the desktop layout
has never been executed by anything", and it was right in the strongest sense.

**2. The obvious fix was also wrong.** `md:block!` emits `display:block!important` with
equal specificity and later source order, which looks like it should win. It does not: for
**important** declarations the CSS cascade **reverses** layer order, so preflight's `base`
layer beats anything in `utilities`. No utility can override that rule while it carries
`!important`. The fix is the `hidden` *class*, where both declarations are ordinary and the
variant wins by ordinary rules.

Three build-and-test cycles went into that, and the answer only became clear after probing
`getComputedStyle` in a real browser rather than reasoning about specificity.

**3. My own test navigated to the wrong page and I blamed the CSS.** Two of those cycles
were spent on a locator reporting "element(s) not found" while the markup was demonstrably
correct — because `page.goto(WEB_APP)` loads `/`, and the story is on `/workbench`. The
other workbench tests use `${WEB_APP}/workbench`; I copied the wrong neighbour.

**4. And the paired test was passing vacuously.** `toBeHidden()` passes for an element that
is **not in the DOM at all**, so the mobile assertion was green throughout — including
while the desktop one could not find the element. Now every panel is asserted attached
before it is asserted hidden.

**5. A stale `next start` served an old build.** Four modal E2E tests failed for reasons
unrelated to anything I had changed; the port was held by a server from an earlier session.
`P1-21` recorded this exact trap and I walked into it anyway. Killing the process by PID
fixed all four.

**6. Switching to the `hidden` class made two `role="status"` elements visible in jsdom.**
jsdom applies no CSS, so the class hides nothing there and the save-status indicator joined
the accessibility tree — an unscoped `getByRole("status")` then finds two. The query is now
scoped to the preview panel. Worth knowing generally: **jsdom honours the `hidden`
attribute and ignores the class**, so this change made unit tests see all three panels at
once.

## Follow-Ups and Open Questions

- **`enabledSections` is derived in `EditorScreen` from `enabled_by_default`**, which is
  the template's opinion rather than the invitation's. The invitation's real settings reach
  the renderer separately and correctly; the derived list feeds `SectionListPanel`'s
  toggles. Worth revisiting in `P2-06`, which owns the section checklist.
- **`GET /templates/:slug/versions/:version` is called on every editor load** and is
  cached server-side for an hour. No client cache, so a reload re-fetches. Fine now;
  `P2-11` may want TanStack Query around it.
- **DF-11 is discharged against the shell's layout, not the live editor route.** The
  distinction is recorded in the story file itself: it proves three panels are
  simultaneously visible at a desktop viewport, and it does not prove the editor's
  behaviour at that viewport. A session-authenticated Playwright walk belongs with
  `P2-14`.
- **`docs/UI-UX/12` mentions a "scaled desktop"** and this renders desktop unscaled. A
  transform-scaled frame inside a panel narrower than a desktop viewport previews a size
  nobody uses; if the intent was a zoomed-out full-width view, that is a different feature
  and needs the document to say so.

## What to Watch

**The `hidden` class versus the attribute is now load-bearing in two places** —
`EditorShell`'s panels and the workbench story. Anyone "tidying" one back to the attribute
reintroduces a bug that only a browser can see, which is why both carry the explanation
inline rather than a reference to this record.

**`toBeHidden` passing for absent elements is a general hazard**, not a one-off. Any
Playwright assertion that something is *not* visible should be paired with an attachment
check, or it silently stops testing anything the moment a selector drifts.
