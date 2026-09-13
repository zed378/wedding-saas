# P2-17 — Feature Spec: Indonesian Administrative Regions

| | |
|---|---|
| **Task** | `P2-17` |
| **Requested by** | The project owner, 2026-09-13: *"tambahkan database semua kota dan provinsi yang ada di indonesia — beserta kelurahan dan kecamatannya"* |
| **Status** | Written before implementation |

## 1. Goal

A reference database of every province, regency/city, district (kecamatan) and village
(kelurahan/desa) in Indonesia, used to (a) let a couple place an event in a real administrative
unit, and (b) decide the event's timezone **exactly** — from the chosen province, or from the
province whose boundary contains the map pin — replacing `P2-16`'s approximation wherever the
database is available.

## 2. Specification Sources

- The owner's request (above) and `OQ-27`'s timezone answer (ADR-070).
- **Data**: [`cahyadsn/wilayah`](https://github.com/cahyadsn/wilayah), MIT licence, commit
  `686c3400caa75bd7de6a7ac107af073897276133` (2026-09-11). Files `db/wilayah.sql` (codes and names,
  all four levels) and `db/wilayah_level_1_2.sql` (capital, coordinates, UTC offset, boundary
  polygons for provinces and regencies). Both file headers cite **Kepmendagri No. 300.2.2-2138
  Tahun 2025**; the repository description cites 300.2.2-2430 Tahun 2025. The counts below are
  what was verified, whatever the label.
- Verified counts: **38 provinces, 514 regencies/cities, 7,285 districts, 83,762 villages**
  (91,599 rows); every code well-formed (`11`, `11.01`, `11.01.01`, `11.01.01.2001`); all 552
  level-1/2 rows carry coordinates and a polygon; every regency's offset equals its province's; the
  38 province offsets match ADR-070's WIB/WITA/WIT lists exactly.

## 3. Business Rules Implemented

- **R1** — An event's zone, in order: an explicit `timezone` in the request; else the province of
  `region_code`; else the province whose boundary contains the pin; else `P2-16`'s coordinate rule;
  else WIB.
- **R2** — `region_code` must exist in `regions`. Any level may be chosen; the most specific the
  couple picked is stored.
- **R3** — The region list is reference data: the same for every user, public, and changed only
  by re-importing a newer decree.

## 4. API Contract

All under `/api/v1/regions`, anonymous, `Cache-Control: public, max-age=86400`, Redis-cached,
rate-limited under `general-public`.

| Method | Path | Returns |
|---|---|---|
| GET | `/regions` | the 38 provinces |
| GET | `/regions?parent=<code>` | the children of a province, regency or district (400 on a malformed code, 404 on an unknown one) |
| GET | `/regions/:code` | one region with its ancestors (`province`, `regency`, `district`) |
| GET | `/regions/locate?latitude=&longitude=` | `{ province, regency, timezone }` for a point, or 404 when it lies in no province boundary |

Region object: `{ code, name, kind, level, timezone? }` — `kind` one of `provinsi`, `kabupaten`,
`kota`, `kecamatan`, `kelurahan`, `desa`; `timezone` on provinces and regencies.

Events (`docs/API/04`): `region_code` optional on create and update (`null` clears); served on
the owner detail with the resolved names. **Not** added to the public payload — the address text
remains what guests read; exposing the codes is a separate decision.

## 5. Data Model Impact

- `regions (code varchar(13) PK, parent_code varchar(13) NULL REFERENCES regions, level smallint
  CHECK 1..4, kind varchar(10) CHECK, name varchar(100), capital varchar(100) NULL, latitude
  numeric(9,6) NULL, longitude numeric(9,6) NULL, timezone varchar(40) NULL CHECK)`, index on
  `parent_code`.
- `region_boundaries (code PK REFERENCES regions, min_lat, max_lat, min_lng, max_lng numeric,
  polygon jsonb)` for levels 1 and 2, simplified.
- `invitation_events.region_code varchar(13) NULL REFERENCES regions(code) ON DELETE SET NULL`.
- Migration `0009`; data loaded by the seed (idempotent upsert), not by the migration — schema and
  content stay separate (`docs/DATABASE/00`). Production requires running the seed's region step.
- Vendored data: generated compact files under `backend/api/src/infra/db/seed-data/regions/`, with
  the upstream MIT notice, and the import script that regenerates them.

## 6. Authorization

Region reads are public reference data with no tenant dimension — exempt from the IDOR sweep with
this reason (`idor-sweep-inventory.spec.ts`). `region_code` on an event is written only through the
existing owner-scoped event routes.

## 7. Validation and Sanitization

Codes validated by shape (`^\d{2}(\.\d{2}(\.\d{2}(\.\d{4})?)?)?$`) before any query; coordinates as
in `P1-12`. Region names come from the import, never from users; the request field `region_code` is
registered `NOT_USER_TEXT`.

## 8. State Transitions

None.

## 9. Side Effects

Setting `region_code` (without an explicit `timezone`) updates the event's `timezone` (R1).

## 10. Failure Modes

- Regions not seeded: list endpoints return empty; `locate` 404s; event writes with a `region_code`
  fail the FK → 400 `INVALID_REGION`; timezone falls back to `P2-16`'s rule. The editor's pickers say
  the list is unavailable.
- Point on water or outside Indonesia: `locate` 404; the editor keeps the coordinate rule.

## 11. Abuse Cases

- Enumerating codes: public data; rate limit suffices.
- Expensive `locate` calls: bounding-box prefilter, simplified polygons, rate limit; results cached
  by rounded coordinates.
- Malformed `parent` or `:code`: rejected before querying.

## 12. Test Plan

- Import: counts per level; code shape; parent integrity; province → zone table.
- Point-in-polygon: the 47 `P2-16` places resolve to their zones through boundaries, plus provinces
  for capitals.
- API integration: lists, children, one region with ancestors, locate hit and miss, malformed codes,
  cache headers.
- Events: `region_code` sets zone; explicit zone wins; unknown code 400; FK `SET NULL`.
- Editor: cascading pickers load children; choosing a regency sets the zone; pin → locate fills
  region and zone.
- IDOR inventory exemption with reason.

## 13. Observability

`regions.locate` hit/miss counts in logs; seed step logs row counts.

## 14. Open Questions

- Whether guests should see region names (e.g. *Kec. Kuta, Kab. Badung*) on the public page — not
  decided here; the address field stays the displayed text.
- Refresh cadence when Kemendagri issues a new decree — the import script is the mechanism; who runs
  it is an operations question.
