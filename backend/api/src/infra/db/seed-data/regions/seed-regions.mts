/**
 * `P2-17` — load Indonesia's administrative regions into `regions` and `region_boundaries`.
 *
 * Idempotent: an upsert by code, so re-running after a new decree updates names and adds codes.
 * A code that disappears from a newer decree is **not** deleted here — events may reference it
 * (`ON DELETE SET NULL` would silently clear a couple's choice), and a region renumbering is worth
 * a person looking at. The count of stale codes is reported instead.
 *
 * Unlike the development seed this runs in every environment, production included: it is
 * reference data the product needs, not sample data (`db:seed:regions`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";

const HERE = import.meta.dirname;
const BATCH = 2000;

type Ring = [number, number][];

export interface RegionSeedResult {
  readonly regions: Record<number, number>;
  readonly boundaries: number;
  readonly stale: number;
}

/** `kabupaten` or `kota` from a regency's name; `kelurahan` or `desa` from a village's code. */
export function kindOf(code: string, name: string): string {
  const level = code.split(".").length;
  if (level === 1) return "provinsi";
  if (level === 2) return /^kota\b/i.test(name) ? "kota" : "kabupaten";
  if (level === 3) return "kecamatan";
  // Kemendagri numbers a village's last segment from 1xxx for a kelurahan, 2xxx for a desa.
  return code.slice(-4).startsWith("1") ? "kelurahan" : "desa";
}

export async function seedRegions(pool: Pool): Promise<RegionSeedResult> {
  const rows = readFileSync(join(HERE, "regions.tsv"), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => {
      const [code, name] = line.split("\t") as [string, string];
      return { code, name };
    });
  const details = JSON.parse(
    readFileSync(join(HERE, "regions-level-1-2.json"), "utf8"),
  ) as Record<
    string,
    {
      capital: string | null;
      latitude: number;
      longitude: number;
      timezone: string;
    }
  >;
  const boundaries = JSON.parse(
    readFileSync(join(HERE, "boundaries.json"), "utf8"),
  ) as Record<string, Ring[]>;

  const counts: Record<number, number> = {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Sorted by code, so every parent is written before its children.
    for (let start = 0; start < rows.length; start += BATCH) {
      const batch = rows.slice(start, start + BATCH);
      const values: unknown[] = [];
      const tuples = batch.map(({ code, name }, i) => {
        const level = code.split(".").length;
        counts[level] = (counts[level] ?? 0) + 1;
        const detail = details[code];
        values.push(
          code,
          level === 1 ? null : code.split(".").slice(0, -1).join("."),
          level,
          kindOf(code, name),
          name,
          detail?.capital ?? null,
          detail?.latitude ?? null,
          detail?.longitude ?? null,
          detail?.timezone ?? null,
        );
        const o = i * 9;
        return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9})`;
      });
      await client.query(
        `INSERT INTO regions (code, parent_code, level, kind, name, capital, latitude, longitude, timezone)
         VALUES ${tuples.join(",")}
         ON CONFLICT (code) DO UPDATE SET
           parent_code = EXCLUDED.parent_code, level = EXCLUDED.level, kind = EXCLUDED.kind,
           name = EXCLUDED.name, capital = EXCLUDED.capital, latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude, timezone = EXCLUDED.timezone`,
        values,
      );
    }

    for (const [code, rings] of Object.entries(boundaries)) {
      const all = rings.flat();
      const lngs = all.map(([x]) => x);
      const lats = all.map(([, y]) => y);
      await client.query(
        `INSERT INTO region_boundaries (code, min_latitude, max_latitude, min_longitude, max_longitude, rings)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (code) DO UPDATE SET
           min_latitude = EXCLUDED.min_latitude, max_latitude = EXCLUDED.max_latitude,
           min_longitude = EXCLUDED.min_longitude, max_longitude = EXCLUDED.max_longitude,
           rings = EXCLUDED.rings`,
        [
          code,
          Math.min(...lats),
          Math.max(...lats),
          Math.min(...lngs),
          Math.max(...lngs),
          JSON.stringify(rings),
        ],
      );
    }

    const known = new Set(rows.map((r) => r.code));
    const { rows: existing } = await client.query<{ code: string }>(
      "SELECT code FROM regions",
    );
    const stale = existing.filter((r) => !known.has(r.code)).length;

    await client.query("COMMIT");
    return {
      regions: counts,
      boundaries: Object.keys(boundaries).length,
      stale,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
