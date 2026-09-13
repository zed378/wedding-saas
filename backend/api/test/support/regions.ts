import type { Pool } from "pg";

import { seedRegions } from "../../src/infra/db/seed-data/regions/seed-regions.mts";

/**
 * `P2-17` — make sure the region reference data is present, once per database.
 *
 * `resetDatabase` does not touch `regions` (it is reference data, not tenant data), so a local
 * database pays the ~20s load once and every later run skips it; a fresh container pays it on its
 * first region test.
 */
export async function ensureRegionsSeeded(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM regions",
  );
  if (Number(rows[0]?.n ?? 0) >= 91_599) return;
  await seedRegions(pool);
}

/** A cache that remembers nothing, for services built outside Nest. */
export const noCache = {
  getJson: async () => undefined,
  setJson: async () => undefined,
  invalidateNamespace: async () => 0,
};
