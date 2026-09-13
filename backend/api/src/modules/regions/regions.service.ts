import { Inject, Injectable } from "@nestjs/common";

import { CACHE, type CachePort } from "../../infra/cache/cache.port";
import { NotFoundError } from "../../http/errors";
import { logger } from "../../shared/logging/logger";
import { ancestorCodes, containsPoint } from "./region-geometry";
import { RegionsRepository, type RegionRow } from "./regions.repository";

/**
 * `P2-17` — Indonesia's administrative regions. `MEMORY/specs/P2-17-regions.md`.
 *
 * Reference data that changes when Kemendagri issues a decree, so every read is cached for a day
 * under its own namespace; a re-import bumps the generation (`cache:gen:regions`) the way a template
 * publish does.
 */

export const REGION_CACHE_NAMESPACE = "regions";
const TTL_SECONDS = 86_400;

export interface RegionDto {
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly level: number;
  /** Provinces and regencies. */
  readonly timezone?: string;
}

export interface RegionDetailDto extends RegionDto {
  /** The chain above this region, province first. */
  readonly ancestors: readonly RegionDto[];
}

export interface LocatedDto {
  readonly province: RegionDto;
  readonly regency: RegionDto | null;
  readonly timezone: string;
}

const toDto = (row: RegionRow): RegionDto => ({
  code: row.code,
  name: row.name,
  kind: row.kind,
  level: row.level,
  ...(row.timezone === null ? {} : { timezone: row.timezone }),
});

@Injectable()
export class RegionsService {
  constructor(
    private readonly repository: RegionsRepository,
    @Inject(CACHE) private readonly cache: CachePort,
  ) {}

  async list(parentCode: string | undefined): Promise<RegionDto[]> {
    const key = `children:${parentCode ?? "root"}`;
    const cached = await this.cache.getJson<RegionDto[]>(
      REGION_CACHE_NAMESPACE,
      key,
    );
    if (cached !== undefined) return cached;

    if (parentCode !== undefined) {
      // An unknown parent is a 404, not an empty list: a village code has no children and
      // exists; a mistyped code does not, and the two must not look alike.
      const [parent] = await this.repository.byCodes([parentCode]);
      if (parent === undefined) throw new NotFoundError();
    }

    const rows =
      parentCode === undefined
        ? await this.repository.provinces()
        : await this.repository.children(parentCode);
    const result = rows.map(toDto);
    await this.cache.setJson(REGION_CACHE_NAMESPACE, key, result, TTL_SECONDS);
    return result;
  }

  async detail(code: string): Promise<RegionDetailDto> {
    const key = `detail:${code}`;
    const cached = await this.cache.getJson<RegionDetailDto>(
      REGION_CACHE_NAMESPACE,
      key,
    );
    if (cached !== undefined) return cached;

    const rows = await this.repository.byCodes([...ancestorCodes(code), code]);
    const self = rows.find((row) => row.code === code);
    if (self === undefined) throw new NotFoundError();

    const result: RegionDetailDto = {
      ...toDto(self),
      ancestors: rows.filter((row) => row.code !== code).map(toDto),
    };
    await this.cache.setJson(REGION_CACHE_NAMESPACE, key, result, TTL_SECONDS);
    return result;
  }

  /** The province (and regency) whose boundary contains a point, or 404. */
  async locate(latitude: number, longitude: number): Promise<LocatedDto> {
    // Four decimals is about eleven metres: finer than the simplified boundaries, coarse enough
    // that a couple nudging a pin does not miss the cache every time.
    const key = `locate:${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const cached = await this.cache.getJson<LocatedDto | { miss: true }>(
      REGION_CACHE_NAMESPACE,
      key,
    );
    if (cached !== undefined) {
      if ("miss" in cached) throw new NotFoundError();
      return cached;
    }

    const candidates = await this.repository.boundaryCandidates(
      latitude,
      longitude,
    );
    const hits = candidates
      .filter((c) => containsPoint(c.rings, longitude, latitude))
      .map((c) => c.code);
    const provinceCode = hits.find((code) => code.length === 2);

    if (provinceCode === undefined) {
      logger.info(
        { context: { event: "regions.locate", result: "miss" } },
        "point in no province",
      );
      await this.cache.setJson(
        REGION_CACHE_NAMESPACE,
        key,
        { miss: true },
        TTL_SECONDS,
      );
      throw new NotFoundError();
    }

    // A regency must belong to the province found; near a border a simplified polygon can
    // overlap its neighbour's by a few metres.
    const regencyCode = hits.find(
      (code) => code.length === 5 && code.startsWith(`${provinceCode}.`),
    );
    const rows = await this.repository.byCodes(
      regencyCode === undefined ? [provinceCode] : [provinceCode, regencyCode],
    );
    const province = rows.find((row) => row.code === provinceCode)!;
    const regency = rows.find((row) => row.code === regencyCode);

    const result: LocatedDto = {
      province: toDto(province),
      regency: regency === undefined ? null : toDto(regency),
      timezone: province.timezone!,
    };
    logger.info(
      { context: { event: "regions.locate", result: "hit" } },
      "point located",
    );
    await this.cache.setJson(REGION_CACHE_NAMESPACE, key, result, TTL_SECONDS);
    return result;
  }

  /** The zone of any region, from its province. `undefined` for an unknown code. */
  async timezoneFor(code: string): Promise<string | undefined> {
    const [province] = await this.repository.byCodes([code.slice(0, 2)]);
    if (province === undefined) return undefined;
    const [self] = await this.repository.byCodes([code]);
    return self === undefined ? undefined : (province.timezone ?? undefined);
  }
}
