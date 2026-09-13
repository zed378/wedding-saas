# 10 - Regions API

Indonesia's administrative regions — province, regency/city, district (kecamatan) and village
(kelurahan/desa) — as public reference data. Added by `P2-17` at the project owner's request;
specification in `MEMORY/specs/P2-17-regions.md`, decision in ADR-071.

Source: Kepmendagri No. 300.2.2-2138 Tahun 2025, via `cahyadsn/wilayah` (MIT). 38 provinces, 514
regencies/cities, 7,285 districts, 83,762 villages. Loaded with `pnpm --filter @wi/api
db:seed:regions`, which runs in every environment.

All endpoints: no authentication, `Cache-Control: public, max-age=86400`, cached in Redis under
`regions`, rate-limited under `general-public` (SECURITY/10). Codes are validated by shape
(`^\d{2}(\.\d{2}(\.\d{2}(\.\d{4})?)?)?$`) before any query.

```
GET /api/v1/regions                                    The 38 provinces
GET /api/v1/regions?parent=51                           The children of a province, regency or district
GET /api/v1/regions/51.71.01.1001                        One region with its ancestors
GET /api/v1/regions/locate?latitude=-8.65&longitude=115.22   The province and regency containing a point
```

## Region object

```json
{ "code": "51.71", "name": "Kota Denpasar", "kind": "kota", "level": 2, "timezone": "Asia/Makassar" }
```

- `kind`: `provinsi` | `kabupaten` | `kota` | `kecamatan` | `kelurahan` | `desa`. A village is a
  `kelurahan` when its code's last segment starts with 1 and a `desa` when it starts with 2
  (Kemendagri's numbering).
- `timezone` is present on provinces and regencies (a district or village takes its province's).

## Responses

- `GET /regions?parent=` — an unknown parent is **404**, not an empty list: a village has no
  children and exists; a mistyped code does not, and the two must not look alike. A malformed code
  is 400.
- `GET /regions/:code` — adds `ancestors`, province first.
- `GET /regions/locate` — `{ province, regency, timezone }`. Containment uses the province and
  regency boundaries, simplified to about 55 m; a point in no province (sea, abroad) is 404. The
  regency returned always belongs to the province returned.

## Use by events

`region_code` on `POST`/`PATCH /invitations/:id/events` (API/04) takes any of these codes. Its
province decides the event's `timezone` unless one is sent explicitly. Region codes are not in the
public invitation payload (API/08).

## Data ownership

The tables are read-only for the application role (migration `0009`). A newer decree is imported
with `backend/api/src/infra/db/seed-data/regions/import-regions.mts`; codes that disappear are kept
and reported rather than deleted, because events may reference them.
