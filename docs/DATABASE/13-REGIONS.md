# 13 - Regions

Indonesia's administrative regions as reference data. `P2-17`, ADR-071,
`MEMORY/specs/P2-17-regions.md`. Source: Kepmendagri No. 300.2.2-2138 Tahun 2025 via
`cahyadsn/wilayah` (MIT).

```sql
CREATE TABLE regions (
  code         VARCHAR(13) PRIMARY KEY,                 -- '51', '51.71', '51.71.01', '51.71.01.1001'
  parent_code  VARCHAR(13) REFERENCES regions(code),     -- NULL for a province
  level        SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 4),
  kind         VARCHAR(10) NOT NULL CHECK (kind IN ('provinsi','kabupaten','kota','kecamatan','kelurahan','desa')),
  name         VARCHAR(100) NOT NULL,
  capital      VARCHAR(100),                             -- provinces and regencies
  latitude     DECIMAL(9,6),
  longitude    DECIMAL(9,6),
  timezone     VARCHAR(40) CHECK (timezone IS NULL OR timezone IN ('Asia/Jakarta','Asia/Makassar','Asia/Jayapura'))
);
CREATE INDEX idx_regions_parent ON regions(parent_code);

CREATE TABLE region_boundaries (
  code           VARCHAR(13) PRIMARY KEY REFERENCES regions(code) ON DELETE CASCADE,
  min_latitude   DECIMAL(9,6) NOT NULL,
  max_latitude   DECIMAL(9,6) NOT NULL,
  min_longitude  DECIMAL(9,6) NOT NULL,
  max_longitude  DECIMAL(9,6) NOT NULL,
  rings          JSONB NOT NULL                          -- [[[longitude, latitude], ...], ...], even-odd
);

-- Reference data: the application role reads, never writes.
GRANT SELECT ON regions, region_boundaries TO wedding_app;
REVOKE INSERT, UPDATE, DELETE ON regions, region_boundaries FROM wedding_app;
```

## Notes
- 38 / 514 / 7,285 / 83,762 rows at levels 1–4 (91,599). 416 kabupaten and 98 kota; 8,496 kelurahan and 75,266 desa.
- Rows are loaded by `db:seed:regions` (an idempotent upsert that runs in production too), not by the migration.
- Boundaries exist for provinces and regencies only, simplified to about 55 m.
- `invitation_events.region_code` references `regions(code)` with `ON DELETE SET NULL` (DATABASE/05). The import never deletes a code that disappears from a newer decree; it reports it.
