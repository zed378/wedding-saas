import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { regionBoundaries, regions } from "../../infra/db/schema";
import type { Ring } from "./region-geometry";

export type RegionRow = typeof regions.$inferSelect;

/**
 * `P2-17` — reads of the region reference tables. The application role cannot write them
 * (migration 0009), and nothing here tries to.
 */
@Injectable()
export class RegionsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async provinces(): Promise<RegionRow[]> {
    return this.db
      .select()
      .from(regions)
      .where(isNull(regions.parentCode))
      .orderBy(asc(regions.code));
  }

  async children(parentCode: string): Promise<RegionRow[]> {
    return this.db
      .select()
      .from(regions)
      .where(eq(regions.parentCode, parentCode))
      .orderBy(asc(regions.code));
  }

  async byCodes(codes: readonly string[]): Promise<RegionRow[]> {
    if (codes.length === 0) return [];
    return this.db
      .select()
      .from(regions)
      .where(inArray(regions.code, [...codes]))
      .orderBy(asc(regions.code));
  }

  /** Provinces and regencies whose bounding box contains the point, with their rings. */
  async boundaryCandidates(
    latitude: number,
    longitude: number,
  ): Promise<{ code: string; rings: Ring[] }[]> {
    const lat = String(latitude);
    const lng = String(longitude);
    const rows = await this.db
      .select({ code: regionBoundaries.code, rings: regionBoundaries.rings })
      .from(regionBoundaries)
      .where(
        and(
          lte(regionBoundaries.minLatitude, lat),
          gte(regionBoundaries.maxLatitude, lat),
          lte(regionBoundaries.minLongitude, lng),
          gte(regionBoundaries.maxLongitude, lng),
        ),
      );
    return rows.map((row) => ({ code: row.code, rings: row.rings as Ring[] }));
  }
}
