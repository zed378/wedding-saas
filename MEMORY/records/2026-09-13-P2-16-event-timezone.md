# P2-16 — Event Timezone (WIB/WITA/WIT)

| | |
|---|---|
| **Task** | `P2-16` (added after Phase 2 closed, from the owner's answer to `OQ-27`) |
| **Date** | 2026-09-13 |
| **Branch** | `feat/P2-16-event-timezone` |
| **Status** | DONE |
| **Spec** | The owner's answer: *detect the timezone from the map pin, or add an option in the form* — both were built |

---

## What changed

Every event now has a timezone — WIB (`Asia/Jakarta`), WITA (`Asia/Makassar`) or WIT
(`Asia/Jayapura`). Dropping a pin in the editor fills it; a select lets the couple change it. The
public page labels each time with its own zone and counts down to the right instant, and the
link-preview structured data carries the offset. Before, every event was shown and counted down
as WIB: a wedding in Bali or Makassar counted down to an hour after it began; one in Papua, two.

## Why

`OQ-27`, raised in `P2-14` from the hard-coded `" WIB"` in `EventCardDouble`; answered by the
project owner the same day.

## How

- **`@wi/schema`** — `event-timezone.ts`: the three zones (value, abbreviation, fixed offset),
  `timezoneForCoordinates` (simplified province-boundary rules plus a West/Central Kalimantan
  polygon), `timezoneAbbreviation`, `timezoneOffset`. `events.*.timezone` added to the canonical
  field vocabulary and labels. The template validator now requires a section that declares an
  event time to declare the zone.
- **Database** — migration `0008_event_timezone` (column, default WIB, CHECK). Existing rows keep
  WIB, which is how they were read. `drizzle-kit generate` produced it cleanly — the first
  migration since `P2-14` repaired the snapshot chain.
- **API** — request schema accepts the three values; `EventsService` applies explicit → pin →
  WIB on create, and re-detects when the pin moves unless a zone is sent with it; owner and public
  DTOs serve it.
- **Renderer** — `EventCardDouble` label and countdown offset from the event's zone.
- **Editor** — registry select (WIB/WITA/WIT, with helper text), adapter default, new-event
  default, and the map picker's change also writes the detected zone.
- **Public page** — JSON-LD `startDate` with the offset.
- **Reference template** — the event section declares `events.*.timezone`.

## Files and Components Touched

- `packages/schema/src/invitation/{event-timezone.ts (new),event-timezone.spec.ts (new),field-registry.ts,field-labels.ts,field-registry.spec.ts}`, `src/template/{section.schema.ts,template-version.spec.ts}`, `src/index.ts`
- `backend/api/migrations/0008_event_timezone.{sql,down.sql}`, `meta/0008_snapshot.json`, `_journal.json`, `src/infra/db/schema/invitations.ts`, `src/infra/db/seed-data/reference-template.json`
- `backend/api/src/modules/invitation/{invitation.controller,events.service,invitation.dto}.ts`, `modules/publishing/public-invitation.dto.ts`, `shared/tenancy/invitation-repository.ts`
- `backend/api/test/integration/{events,public-invitation}.itest.ts`, `test/invitation-http.spec.ts`
- `packages/template-renderer/src/sections/{EventCardDouble.tsx,sections.spec.tsx}`
- `frontend/web-app/src/editor/{PropertiesPanel.tsx,transport.ts,fields/registry.ts}`, `test/editor-document.spec.tsx`
- `frontend/public-invite/src/lib/metadata.ts`, `test/metadata.spec.ts`
- `docs/PLAN/08`, `docs/DATABASE/05`, `docs/API/04`, `docs/API/08`, `TASKS/BACKLOG.md`, `MEMORY/DECISIONS.md` (ADR-070)

## Decisions Made

ADR-070. Also: detection deliberately does not try to exclude neighbouring countries (it would
drop Sumatran towns on the Malacca Strait); the first test draft claimed it did and was
corrected, not the function.

## Deviations from `docs/`

`docs/PLAN/08` § Entity: Event, `docs/DATABASE/05`, `docs/API/04` and `docs/API/08` amended to add
the field. The template validator gained a rule not in `docs/PLAN/07`: a section showing a time
must declare its zone.

## Tests Added

| Test | Proves | Mutation |
|---|---|---|
| `event-timezone.spec.ts` (52) | 47 real places, weighted to the borders; out-of-box refusals; abbreviations and offsets; WIB fallback | — |
| `template-version.spec.ts` › "event times and their timezone" (2) | Validator refuses a time without a zone | — |
| `field-registry.spec.ts` count 11 → 12 | Deliberate vocabulary change | Failed until updated, as designed |
| `events.itest.ts` › "the event's timezone" (5) | Default; pin detection; explicit wins; re-detect on move, unchanged otherwise, explicit on update; DB CHECK | — |
| `invitation-http.spec.ts` › "rejects a timezone outside Indonesia" | Request schema | — |
| `sections.spec.tsx` (3) | Countdown instant for WITA and WIT; label shows WITA and not WIB | — |
| `editor-document.spec.tsx` (2) | Pin to Denpasar switches the select to WITA and saves the zone with the pin; manual choice saves alone | Removing the pin fill → fails |
| `metadata.spec.ts` (1 new, 1 changed) | JSON-LD `startDate` with `+08:00` for WITA; WIB offset by default | — |

Integration run of events, public invitation, reference template, phase 1 acceptance and change
template: 114 passing. Full-stack E2Es (`editor-collections`, `template-switch`) passing on the
rebuilt stack.

## Security Verification

- **Enumerated input**: `invitation-http.spec.ts` › "rejects a timezone outside Indonesia"; the
  database CHECK behind it (`events.itest.ts` › "refuses a zone outside Indonesia's three at the
  database").
- No new route; event sub-resource ownership tests unchanged and passing.

## Abuse Cases Covered

- An arbitrary string as a zone → 400, and refused by the database on any other write path.
- Not applicable otherwise.

## Definition of Done Verification

All four card items checked, with the tests named on the card.

## What Did Not Work

- **Typing coordinates character by character in a test** — a controlled number input drops
  "-" as NaN; the component was right, the test drove it wrongly. `fireEvent.change` per field.
- **Claiming country exclusion** in the first test draft (Kuala Lumpur); not achievable with the
  rules without breaking Indonesian towns.

- **Importing `@wi/schema` into the renderer's event card** — the package root pulls in Zod, and
  the public page's first load went from ~140KB to **236KB** gzip against a 150KB budget. The SSR
  budget test (`P2-08`/`P2-13`) failed the build, which is what it is for. Fixed with a
  dependency-free subpath export, `@wi/schema/event-timezone`.
- **`timezone` in the request schema without a sanitizer classification** —
  `check-sanitized-fields` refused it; registered as `NOT_USER_TEXT` (closed enum).

## Follow-Ups and Open Questions

- `P2-17` — the owner's province/regency/district/village database, which should decide a zone
  exactly from a chosen province.
- `OQ-27` date-format half still open.
- Staging: migrations `0007` and `0008`, reseed.

## What to Watch

- Couples outside WIB who created events before this change keep WIB until they open the event
  and re-drop the pin or choose a zone. Worth a nudge in the editor if real data shows many.
