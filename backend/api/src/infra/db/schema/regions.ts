import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  smallint,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * `P2-17` — Indonesia's administrative regions. `MEMORY/specs/P2-17-regions.md`.
 *
 * Reference data from Kepmendagri No. 300.2.2-2138 Tahun 2025 via `cahyadsn/wilayah` (MIT): 38
 * provinces, 514 regencies and cities, 7,285 districts, 83,762 villages. One table for all four
 * levels, because every query the product makes is "the children of this code" or "this code and
 * its ancestors", and the official codes already encode the hierarchy.
 *
 * Loaded by the seed, not by a migration: schema and content are separate (`docs/DATABASE/00`).
 */
export const regions = pgTable(
  "regions",
  {
    /** The Kemendagri code: `11`, `11.01`, `11.01.01`, `11.01.01.2001`. */
    code: varchar("code", { length: 13 }).primaryKey(),
    parentCode: varchar("parent_code", { length: 13 }).references(
      (): AnyPgColumn => regions.code,
    ),
    level: smallint("level").notNull(),
    kind: varchar("kind", { length: 10 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    /** Provinces and regencies only. */
    capital: varchar("capital", { length: 100 }),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    /** Provinces and regencies only; a district or village takes its province's. */
    timezone: varchar("timezone", { length: 40 }),
  },
  (t) => [
    index("idx_regions_parent").on(t.parentCode),
    check("regions_level_check", sql`level BETWEEN 1 AND 4`),
    check(
      "regions_kind_check",
      sql`kind IN ('provinsi', 'kabupaten', 'kota', 'kecamatan', 'kelurahan', 'desa')`,
    ),
    check(
      "regions_timezone_check",
      sql`timezone IS NULL OR timezone IN ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura')`,
    ),
  ],
);

/**
 * Simplified boundaries for provinces and regencies, for `GET /regions/locate`.
 *
 * `rings` is `[[[longitude, latitude], …], …]`; containment is even-odd across all rings. The
 * bounding box columns let a lookup discard almost every region before touching a polygon.
 */
export const regionBoundaries = pgTable("region_boundaries", {
  code: varchar("code", { length: 13 })
    .primaryKey()
    .references(() => regions.code, { onDelete: "cascade" }),
  minLatitude: numeric("min_latitude", { precision: 9, scale: 6 }).notNull(),
  maxLatitude: numeric("max_latitude", { precision: 9, scale: 6 }).notNull(),
  minLongitude: numeric("min_longitude", { precision: 9, scale: 6 }).notNull(),
  maxLongitude: numeric("max_longitude", { precision: 9, scale: 6 }).notNull(),
  rings: jsonb("rings").notNull(),
});
