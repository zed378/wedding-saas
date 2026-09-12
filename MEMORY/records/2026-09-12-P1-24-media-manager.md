# P1-24 — Frontend: media manager and map picker

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-24 |
| **Phase** | Phase 1 |
| **Surface** | web-app |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-24-media-manager` |
| **Status** | Completed |
| **Spec** | Not required by the card; written into this record |

---

## What Changed

The upload queue, the gallery manager and the map picker, wired into the properties panel
through the registry. Plus `MEDIA_PURPOSES` in `@wi/schema`, which the API and the editor now
share.

## Why

`docs/FRONTEND/05`, `docs/PLAN/04` § F4 and F5, `docs/UI-UX/17` § Keyboard navigation, ADR-014.

## How

**The queue guarantees nothing is lost.** Ten files selected at once all arrive; at most three
run concurrently, because `docs/FRONTEND/05` asks for the cap and the reason is the user's
connection — ten simultaneous multipart uploads on a phone means ten that are all slow and no
visible progress for a minute. A failure removes one file from the running set and leaves the
rest; a retry re-enters the **same item**, so its place in the list and its local preview
survive.

**Polling has two terminal cases and neither is a spinner.** A `failed` status is `P1-18`'s
verdict — infected, undecodable, too many pixels — and it is permanent, so it becomes a failed
item rather than another poll. A two-minute timeout covers the other: `P0-15`'s producer
swallows enqueue failures by design, so a job can simply not exist, and a progress indicator
that never resolves is worse than an honest failure with a retry.

**Keyboard reordering is the mechanism, not the fallback.** `docs/UI-UX/17` asks for it by
name for this interaction and the DoD says "fully operable by keyboard". Move-up and move-down
are buttons carrying their position in the accessible name; the debounced `ReorderSender`
behind them sends one call per pause with the final arrangement, because eight presses in four
seconds would otherwise be eight calls each carrying a different complete order, landing out
of sequence.

**The map is the convenience and the coordinates are the contract.** MapLibre needs WebGL,
which jsdom does not have and some browsers disable — so a picker that existed only as a map
would be a field a subset of users could not fill in, and no test here could exercise it. The
two number inputs are the control; the map writes into them; a failure to load says so instead
of showing a grey box.

**A failed reorder reports rather than reverts.** The order the user sees is already applied
locally, and snapping twelve photos back silently is a worse experience than a message saying
it was not saved.

## Files and Components Touched

| Path | Change |
|---|---|
| `frontend/web-app/src/editor/media/upload-queue.ts` | **New** — the queue, the poll, the pre-check |
| `frontend/web-app/src/editor/media/reorder.ts` | **New** — `moveItem`, `ReorderSender` |
| `frontend/web-app/src/editor/media/GalleryManager.tsx` | **New** |
| `frontend/web-app/src/editor/media/MapPicker.tsx` | **New** |
| `frontend/web-app/src/editor/PropertiesPanel.tsx` | renders both, resolved through the registry |
| `packages/schema/src/invitation/media-purpose.ts` | **New** — `MEDIA_PURPOSES`, shared |
| `frontend/web-app/package.json` | `maplibre-gl` ^6.0.0, per ADR-014 |
| `frontend/web-app/test/media-manager.spec.tsx` | **New** — 27 tests |
| `frontend/web-app/test/properties-panel.spec.tsx` | 1 test added, 1 updated |

## Decisions Made

| Decision | Rationale |
|---|---|
| **No `@dnd-kit`** | `docs/FRONTEND/05` suggests it ("e.g., `@dnd-kit`") rather than requiring it. The DoD requires the **keyboard** path, which is a pure function over an array and provable in jsdom; a drag is a sequence of pointer events no test here could exercise honestly. Move-up/down buttons cover the requirement without a dependency |
| The map picker degrades to two number inputs | WebGL is not universally available, and the coordinates are what the endpoint wants |
| MapLibre is imported lazily | Several hundred kilobytes the editor's other panels have no use for |
| `round()` to six decimal places | `DECIMAL(9,6)`. More would be silently truncated, so the value shown and the value returned would differ |
| The map is created once and not on every coordinate change | Re-creating it would fight the user mid-drag |
| Progress is reported in two steps, not continuously | `fetch` has no upload-progress event. Saying "sent, now waiting" is honest; an animated bar that is not measuring anything is not |
| `MEDIA_PURPOSES` moved into `@wi/schema` | `gallery` is both a media purpose and a section key, and the hard-coding guard cannot tell them apart in a string literal — correctly. Importing the value is better practice anyway and keeps the guard strict |
| Uploads and attached photos are two lists | Merging them would show a half-uploaded file with a cover button that cannot work |
| No undo on delete | `docs/FRONTEND/05` suggests a 3-second undo; the server soft-deletes the media, but re-attaching needs an endpoint that accepts a soft-deleted media id and `P1-19` deliberately refuses one. Said plainly rather than offered and broken |

## Deviations from `docs/`

**No drag-and-drop library, and drag is not implemented.** `docs/FRONTEND/05` names `@dnd-kit`
as an example. The card's DoD asks for keyboard operability, which is delivered; the pointer
convenience is not. Recorded as a follow-up rather than claimed.

**No undo toast on delete**, for the reason above.

## Tests Added

28 (27 new, 1 added to the panel suite). Web-app 185 → 213.

| Group | Cases |
|---|---|
| **Ten photos** | all ten arrive with progress and urls; **at most three at a time**; a local preview before anything is sent; polling until ready then the CDN url; **a `failed` verdict is final**; **polling gives up rather than spinning** |
| **A rejected upload** | one fails and the others finish; a human message, never a code; **a retry keeps the item's place and preview**; a retry on a non-failed item is ignored |
| The pre-check | three bad extensions; over 10 MB; what the server accepts; **it does not check magic bytes** |
| **Keyboard reorder** | `moveItem` returns a new array; **an out-of-range move does nothing rather than wrapping**; **one call per pause carrying the final arrangement**; a failure reports rather than reverting; never two calls at once |
| The map picker | **six-decimal precision**; **usable with no map at all**; both inputs labelled; the map tells a screen reader the inputs are the way in; no axe violations |
| Shared vocabulary | `MEDIA_PURPOSES` is what `docs/API/05` names |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| The client pre-check is not a control | `docs/SECURITY/06`, `P1-17` | `"does not check magic bytes, because that would mean reading the file"` — an explicit test that a renamed PDF passes the client and is left to the server |
| A server rejection reaches the user in plain Indonesian | Card step 7 | `"carries a human message, never a code"`, and the per-file rejection list names the file |
| An abandoned page stops uploading | — | `cancelAll` aborts every in-flight request and revokes the previews on unmount |

## DoD Verification

- [x] Uploading ten photos at once succeeds with per-file progress and no lost files.
- [x] Reordering is fully operable by keyboard. It is the **only** implemented mechanism,
      which is the strongest form of this guarantee — see the deviation above.
- [x] A rejected upload shows a specific, human message and leaves other fields untouched.
      Two tests: the batch continues, and the message is the server's own.
- [x] The map picker emits coordinates the events endpoint accepts — rounded to the
      `DECIMAL(9,6)` precision the column stores, so what the user sees is what comes back.

## What Did Not Work

**1. The hard-coding guard from `P1-23` flagged this card's first draft**, and it was right to.
`form.append("purpose", "gallery")` names a **media purpose**, not a section key — they collide
by word. Rather than exempting the file, `MEDIA_PURPOSES` moved into `@wi/schema`, which the
API already validates against. One definition for both sides, no literal in the component, and
the guard stays strict.

**2. A map-picker test typed six characters and asserted the last one.** The component is
controlled, and the test's parent never stored what it emitted — so every keystroke replaced
the previous value and `-6.2088` arrived as `8`. Fixed with a stateful harness, which is what
the editor actually is. Worth noting because the test would have passed with a
weaker assertion and proved the opposite of what it claimed.

**3. `getByLabelText(/lintang/i)` matched two elements.** The map container's own `aria-label`
tells a screen-reader user that the coordinate fields are the way in — so it contains the word
"lintang", and a text query matches the container as well as the input. Queried by role
instead. The label is right and the query was wrong.

## Follow-Ups and Open Questions

- **Drag-to-reorder is not implemented.** The keyboard path is, and it is the one the DoD and
  `docs/UI-UX/17` require. A pointer drag would need `@dnd-kit` or a hand-rolled HTML5 DnD
  implementation, and neither is testable here — worth doing when there is a browser suite
  that can drive it (`P1-25` or Phase 2).
- **There is no undo on delete.** `P1-19` soft-deletes the media, so the file is recoverable in
  principle; an endpoint that re-attaches a soft-deleted media id would make the toast honest.
- **The tile source is MapLibre's public demo.** `https://demotiles.maplibre.org/style.json`
  is fine for development and is not something to launch on. A configured style URL belongs in
  `docs/DEVOPS/02`'s environment table before Phase 3.
- **Upload progress is two steps, not a bar.** `fetch` cannot report it; `XMLHttpRequest`
  can. Worth revisiting only if somebody complains — a 10 MB photo on a decent connection is
  a few seconds.
- **`GET /invitations/:id/media`** still does not exist (`docs/API/05` lists it). The gallery
  reads `/gallery` instead, which is the list that matters here.

## What to Watch

**The concurrency cap is the only thing between a phone and ten parallel multipart uploads.**
It is one number with one test. If somebody raises it "because the server can take it", the
constraint it was protecting was never the server.

**The queue's `#files` map holds every `File` for the life of the component.** That is what
makes a retry possible without re-picking, and it means ten 10 MB photos are 100 MB of
retained blobs until the editor unmounts. `cancelAll` releases the object URLs but not the
files. Acceptable at ten; worth measuring if the quota ever rises.
