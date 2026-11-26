# P5-14 — Preserve decimal input in the map picker

| | |
|---|---|
| Date | 2026-11-26 |
| Task | `TASKS/PHASE-5-ADMIN-PANEL.md` § P5-14 regression verification; existing P1-24 component |
| Phase | Phase 5 acceptance correction |
| Surface | Web app |
| Author | Parallel regression repair lane |
| Commits / PR | Shared uncommitted working tree preserved; no commit or deployment |
| Status | Source correction, focused verification and complete web regression passed; broader P5-14 gates parent-owned |

## What Changed

The map picker's two manual coordinate inputs retain string drafts while emitting finite numeric coordinates to the existing form callback. Numerically equal parent echoes preserve trailing decimal zeros; real external coordinate changes or undefined resets synchronize the inputs. The map, labels, layout, backend/API formats and existing precision helper remain unchanged.

The existing no-WebGL usability test now also checks exact input value, longitude trailing zeros and continued typing. A new test verifies both fields update from external coordinates/reset without emitting synthetic edits.

## Why

The parent's full supported-runtime regression exposed a genuine user input bug: typing `-6.2088` produced `-6.288`, failing `is usable without a map at all`. On each keystroke the component converted the input to Number, the controlled parent echoed that number, and String conversion collapsed the intermediate `-6.20` to `-6.2`. The following digits then described a different location.

This repairs existing P1-24 coordinate entry, required by `docs/FRONTEND/05-MEDIA-HANDLING.md` § Map Picker Component, `docs/PLAN/04-FEATURE-SPECIFICATION.md` § F5 and `docs/UI-UX/17-ACCESSIBILITY.md` §§ Keyboard navigation/Form labels. It is an acceptance regression repair, not new Phase 6 work.

## How

Read P1-24 card and memory, its referenced media/features/accessibility specification sections and the relevant bounded source/test slices before editing. Mandatory project/phase/security memory reading was already complete in this continuation. Graph/JevGraph tools were absent from the exposed catalog; requested local anti-slop core/code paths were absent. All terminal commands used RTK.

Reported the root cause before production edits; coordinator explicitly authorized the smallest source repair. Each input stores its edit string locally. Coordinate-prop effects replace the draft only for a different numeric coordinate or undefined reset; a numeric echo such as `-6.2` leaves `-6.20` intact. Nonempty finite numeric edits still call the existing numeric callback; empty/invalid drafts do not manufacture a coordinate from `Number("")`. This preserves the current numeric API shape and default sibling-coordinate behavior. No map recreation or round/normalization rule was added.

## Files and Components Touched

| Path | Change |
|---|---|
| `frontend/web-app/src/editor/media/MapPicker.tsx` | Preserve manual decimal drafts and synchronize external coordinates |
| `frontend/web-app/test/media-manager.spec.tsx` | Strengthen no-map decimal regression; add external coordinate/reset regression |
| This record | Failure/root cause, repair and actual verification limits |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Keep numeric form callbacks plus local text drafts | Intermediate input syntax contains information a Number cannot retain | Not applicable; localized defect repair |
| Keep role/name-based spinbutton queries | Existing map application label also mentions coordinate names; broad label-text queries are ambiguous | Existing P1-24 test convention preserved |
| Preserve existing negative-latitude assertion and add longitude continuation | Demonstrates real numeric corruption without skipping or weakening the regression | Not applicable |

## Deviations from `docs/`

None. No layout, endpoint, schema or server validation policy changed. Existing MapLibre/public-static-map boundary is preserved.

## Tests Added and Executed

| Check | Actual result |
|---|---|
| Parent before-fix full web suite | 28 files: 408 passing / one failure among 409 tests; log `tmp/p5-continuation-regression-20261126.log` names `is usable without a map at all`, actual latitude -6.288 versus -6.2088 |
| First focused after-fix media suite | One file / 28 tests passed on Node 24.18.0; includes source repair and external-change test, before additional explicit trailing-zero display assertion |
| Final full web suite | **28 files / 410 tests passed**, exit 0 on Node 24.18.0, 156.58 seconds; includes the final trailing-zero assertion and external-change/reset regression |
| Web app typecheck | `tsc --noEmit -p frontend/web-app/tsconfig.json` passes on Node 24.18.0 |
| Scoped lint | Oxlint `--deny-warnings` over both changed files passes |
| Scoped formatting | Prettier `--check` over both changed files passes |
| Build / SQL / browser / dependency / global security gates | Parent-owned; no new result claimed by this lane |

The focused command runs from `frontend/web-app`: `rtk proxy C:/Users/Zed/AppData/Local/OpenClaw/deps/portable-node/node.exe node_modules/vitest/vitest.mjs run test/media-manager.spec.tsx --pool=threads --maxWorkers=1 --no-file-parallelism`. The complete web suite omits the test path and adds `--hookTimeout=60000`, matching the parent's existing invocation rather than changing checked-in timeouts. No assertions were skipped and no global configuration changed.

## Security Verification

| Control | Source | Named evidence / applicability |
|---|---|---|
| Accessible coordinate fallback preserves correct numeric edits | P1-24; UI-UX/17 | `is usable without a map at all` retains -6.2088 and asserts trailing-zero longitude continuation through `106.0800` to `106.08008` |
| External changes synchronize without synthetic form writes | Existing controlled component contract | `updates both manual inputs when external coordinates change` checks both values, undefined reset and callback absence |
| Labels/alternative access | UI-UX/17 | Existing `labels both coordinate inputs`, `tells a screen reader that the inputs are the way in`, `has no axe violations` remain in the full media suite |
| Ownership / mass assignment / payment status / upload pipeline | SECURITY/05–08 | No endpoint, accepted server field, payment writer or upload validator changed; this lane makes no new verification claim for these controls |

## Abuse Cases Covered

The corrected regression covers silent coordinate corruption during ordinary keyboard input, including leading zero after a decimal and trailing-zero continuation. The external-prop test detects stale coordinates after a map/parent update or reset. Existing upload/reorder tests continue to cover their original scenarios; this repair does not certify MIME/malware handling or live map/tile behavior.

## Definition of Done Verification

Appropriate component tests, scoped types/lint/format and a complete web regression are required; actual results are separated above and below. No new ID endpoint, write schema, stored text path, lifecycle change or sensitive log exists. The UI's semantic labels remain intact. Parent owns broad build/integration/security checks and shared TASKS/MEMORY index synchronization. P5-14 remains incomplete until its other gates pass. No threshold, assertion or requirement was waived.

## What Did Not Work

The first feature-doc read guessed a nonexistent PLAN/04 filename; a bounded path lookup found `04-FEATURE-SPECIFICATION.md`. A Windows wildcard argument used in an initial memory search was rejected by ripgrep; the index supplied the exact record path. Both mistakes were read-only. The parent's earlier full run is retained as failed evidence; passing the focused correction does not rewrite that history. jsdom emits expected canvas/WebGL implementation warnings from the existing MapLibre attempt; these are not skipped tests or suppressed errors.

## Follow-Ups and Open Questions

Parent must rebuild the web app after this source change and include the final full-suite result when updating P5-14. The original MapLibre demo tile configuration and P1-24's existing deferred pointer/undo items remain unchanged, not newly waived. No product decision arose. Continue to test real map/WebGL behavior separately from jsdom's coordinate fallback.

## What to Watch

Check manually entered venue coordinates and preserve the separation between draft strings and numeric persisted values in later refactors. Numeric coercion on every controlled render can reintroduce this bug even when the final callback type remains correct. External actual coordinate changes must still replace drafts; numerically equal echoes should preserve in-progress formatting.
