# P1-22 — Frontend: editor shell, store and autosave

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-22 |
| **Phase** | Phase 1 |
| **Surface** | web-app |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-22-editor-shell` |
| **Status** | Completed |
| **Spec** | Not required by the card; written into this record |

---

## What Changed

The three-column editor at `/editor/[invitationId]`: one Zustand store per session, an
autosave manager that debounces and coalesces, a save-status indicator with a retry, the
multi-tab conflict warning, and the section list with completeness indicators and toggles.

## Why

`docs/FRONTEND/06`, `docs/FRONTEND/02` § Editor State Shape, `docs/UI-UX/09` § Editor Layout,
`docs/UI-UX/12` § Autosave & Status Indicator. `docs/UI-UX/18` makes the user's confidence in
autosave an acceptance criterion, which is why the indicator is treated as a feature.

## How

**One store, created per session.** `createStore` from `zustand/vanilla` handed down through
a context, not a module-level `create()` — a singleton would be shared by every invitation a
tab ever opened, so closing one and opening another would start with the first one's data.

**Local state is never discarded on a failed save.** `markFailed` does not touch `data` or
`dirtyFields`: the work is still unsaved, so it is still dirty, and the retry has something to
resend. `docs/FRONTEND/06` says it in capitals and this is the shape that makes it true.

**`markSaved` clears only the fields that were in flight.** A keystroke that arrives while the
request is out stays dirty and goes in the next cycle. Clearing the whole set on success would
mark it saved and it would never be sent — the quiet half of "editing 100 fields loses
nothing".

**One request at a time, one per pause, one per sub-resource.** Two overlapping PATCHes to the
same endpoint can land in either order and the loser silently wins, so a flush during a save
sets a flag and the running cycle goes round again. Each keystroke restarts the debounce, and
`#pending` is a set of paths rather than a list of changes, so twenty characters are one save.
`defaultGroupFor` maps a path to its endpoint, so two fields of the same person are one PATCH.

**The indicator's states are exhaustive.** There is no `else` that renders "Saved" because
nothing else matched. `idle` with dirty fields says "unsaved", which is the window a naive
implementation shows as "Saved" — and that window is exactly the one where the work exists
only in the browser.

**The conflict check has a tolerance.** The client's own save moves `updated_at` forward, so a
plain "newer than known" comparison would flag every second save. Two seconds absorbs clock
skew and the round trip and is irrelevant to a real concurrent edit, which is minutes apart.

**The autosave flushes on unmount.** A pending debounce discarded on navigation is the
quietest way to lose somebody's last sentence.

## Files and Components Touched

| Path | Change |
|---|---|
| `frontend/web-app/src/editor/store.ts` | **New** — the store, `setAtPath`, `getAtPath` |
| `frontend/web-app/src/editor/autosave.ts` | **New** — the manager and the grouping |
| `frontend/web-app/src/editor/transport.ts` | **New** — a group to its `PATCH` |
| `frontend/web-app/src/editor/EditorProvider.tsx` | **New** — one session's store and manager |
| `frontend/web-app/src/editor/SaveStatus.tsx` | **New** — indicator, retry, conflict warning |
| `frontend/web-app/src/editor/SectionListPanel.tsx` | **New** |
| `frontend/web-app/src/editor/EditorShell.tsx` | **New** — three columns, mobile tabs |
| `frontend/web-app/src/editor/EditorScreen.tsx` | **New** — load, and the not-found state |
| `frontend/web-app/src/app/(app)/editor/[invitationId]/page.tsx` | **New** |
| `frontend/web-app/package.json` | `zustand` ^5.0.0, per the stack table |
| `frontend/web-app/test/editor-autosave.spec.ts` | **New** — 28 tests |
| `frontend/web-app/test/editor-shell.spec.tsx` | **New** — 28 tests |

## Decisions Made

| Decision | Rationale |
|---|---|
| The manager is a plain class, not a hook | Timers, an in-flight promise and a pending set are awkward in a closure and trivial in an object — and the tests that matter take a clock and a transport as arguments |
| `EditorProvider` takes a **transport**, not a manager | The provider owns the callbacks, and the callbacks are what connect a save to the store. Injecting a manager would inject callbacks wired to nothing, and the suite would be green while the indicator never moved |
| Panels are `hidden`, not unmounted | Unmounting on a tab switch discards scroll position and unmounts a focused input mid-edit on a phone whose keyboard just resized the viewport |
| The conflict warning sits **outside** the panels | It was inside the preview panel first, so a user editing on the properties tab of a phone would never see it |
| No automatic retry | `docs/UI-UX/12` asks for a manual button. A silent loop against a server rejecting the data is a spinner that never stops |
| A failing sub-resource does not block the others | A failing events endpoint should not hold the couple's names hostage |
| The template definition is `undefined` until `P2-01` | A fabricated section list would render a plausible editor for a template nobody has seen |

## Deviations from `docs/`

None. The layout, the state shape, the status states and the conflict handling are all as
specified.

## Tests Added

56 (28 store and manager, 28 React). Web-app 92 → 148.

| Group | Cases |
|---|---|
| `setAtPath` | does not mutate; creates intermediate objects; replaces a non-object |
| Grouping | six path-to-endpoint mappings; **the two people stay apart** |
| The store | dirty tracking; **stops saying "Saved" on edit**; **a field edited during a save stays dirty**; **a failed save preserves everything**; editing clears the error but not the data; per-session isolation; `updated_at` recorded |
| The manager | **a burst is one request**; one per sub-resource; **100 fields lose nothing**; **never two saves at once**; a keystroke during a save goes next cycle; **failed fields stay queued for the retry**; **no automatic retry**; a failing group does not block the others; flush on stop; nothing accepted after stop |
| The indicator | starts claiming nothing; **says "unsaved" through the debounce**; shows the failure and a retry; **announces assertively**; the retry reaches the manager and reaches "saved"; stops saying "Saved" on the next edit; five relative-time cases |
| The conflict | **warns on a timestamp the client's own save does not explain**; **does not warn on an ordinary save**; dismissible and non-blocking |
| The section list | a toggle only for a configurable section; **the incomplete indicator is named, not only coloured**; it clears when filled; a toggle queues a settings save |
| The shell | three panels in one tree; tabs switch which is exposed; the indicator stays in the header; no axe violations |

## Security Verification

Not a security-facing task. Two things worth recording anyway:

| Control | Requirement | How |
|---|---|---|
| The editor is not a trust boundary | `docs/FRONTEND/01` | The route is under `(app)`, and the load is the real check: a non-owner gets a 404 from the API and sees the not-found state, whatever the client-side guard thought |
| The not-found state does not distinguish "not yours" from "does not exist" | ADR-018 | One message, from `toFriendlyError`, with the API's own 404 behind it |

## DoD Verification

- [x] Editing 100 fields in sequence loses nothing. The test drives 100 distinct paths with a
      200ms gap — which is also the case where a naive debounce sends nothing until the end —
      and asserts all 100 were sent and nothing is left pending.
- [x] A failed save preserves local state and offers a retry; a test simulates an API failure
      mid-edit. Three tests: the store keeps the data and the dirty flag, the manager requeues
      the fields, and the button reaches the manager and succeeds on the second attempt.
- [x] Save status is visible at all times and never shows "Saved" when a request is in flight
      or failed. The states are exhaustive rather than defaulted, and a test watches the
      window between an edit and its save with a deliberately long debounce.
- [x] A concurrent edit from a second tab produces a warning, not a silent overwrite. Plus the
      negative: an ordinary save does **not** warn.

## What Did Not Work

**1. The first version of the React test harness injected a whole `AutosaveManager`.** The
provider builds its own, so the injected one was never used — and if it had been, it carried
the test's no-op callbacks rather than the provider's, which are what connect a save to the
store. Either way the suite would have been green while the indicator never moved. The
provider now takes a **transport**, which is the seam that actually exists.

**2. The conflict warning was unreachable on a phone.** It sat inside the preview panel, and
on mobile the panels are tabs — so somebody editing in the properties tab could not see the
warning about the thing they were doing. Moved above the tab bar. Found because the test
looked for the alert and did not find it, which is the test doing its job rather than the
test being wrong.

**3. Two indicator tests passed for the wrong reason.** With a 10ms debounce the save
completes before the assertion runs, so "says unsaved between an edit and the save" was
asserting a state it never observed. Given a 5s debounce for those cases, which is what makes
them about the window rather than about the end of it.

**4. jsdom evaluates no media queries, so the desktop layout never applies there.** Only the
active tab's panel is exposed, and the section-list tests have to open its tab first. That is
correct behaviour being correctly observed rather than a workaround — and it means those
assertions are about the **mobile** layout. The desktop three-column arrangement is not
covered by any test; it is CSS, and the browser suite would be the place.

## Follow-Ups and Open Questions

- **The desktop layout is untested.** `md:` breakpoints do not exist in jsdom. A Playwright
  check at a desktop viewport asserting three panels are simultaneously visible belongs with
  `P1-25`'s suite, once the editor can be reached with a session.
- **`templateDefinition` is always `undefined`** until `P2-01` serves the catalogue, so the
  section list renders nothing in production today and the editor is a shell with two
  placeholders. Honest, and it means this card cannot be demonstrated end to end yet.
- **`transport.ts` is untested against the real API.** Its endpoint table is exercised only
  through the group keys; whether `PATCH /invitations/:id/couple/groom` accepts the body it
  builds is unverified until `P1-23` sends a real field.
- **Section keys are rendered raw** (`hero`, `gallery`) rather than as labels. `docs/PLAN/07`
  has no display name for a section; `P2-01` or `P2-03` will need one.

## What to Watch

**`markSaved` clearing only the fields it was given is subtle and load-bearing.** A
"simplification" to `dirtyFields.clear()` passes every happy-path test and silently drops
every keystroke typed during a save. The test named `"keeps a field dirty when it changed
again during the save"` is the only thing standing there.

**The conflict tolerance is a magic number.** Two seconds; too small and every save warns,
too large and a genuine concurrent edit within it is missed. If the API ever starts returning
`updated_at` with a different precision, this is the first thing to re-check.
