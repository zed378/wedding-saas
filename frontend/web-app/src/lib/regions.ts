import type { ApiClient } from "@wi/api-client";

/** `P2-17` — `GET /regions`. `MEMORY/specs/P2-17-regions.md` § 4. */
export interface Region {
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly level: number;
  readonly timezone?: string;
}

/**
 * The provinces, or the children of `parent`. Anonymous: public reference data, cached by the API
 * and shareable by any cache, so it carries no session.
 */
export async function listRegions(
  api: ApiClient,
  parent?: string,
): Promise<readonly Region[]> {
  const result = await api.request<Region[]>("/regions", {
    ...(parent === undefined ? {} : { query: { parent } }),
    anonymous: true,
  });
  return result.data;
}

/** `GET /regions/locate` — the province and regency whose boundary contains a point. */
export async function locateRegion(
  api: ApiClient,
  latitude: number,
  longitude: number,
): Promise<
  { province: Region; regency: Region | null; timezone: string } | undefined
> {
  try {
    const result = await api.request<{
      province: Region;
      regency: Region | null;
      timezone: string;
    }>("/regions/locate", {
      query: { latitude, longitude },
      anonymous: true,
    });
    return result.data;
  } catch {
    // Water, abroad, or the regions not loaded: the caller keeps what it had.
    return undefined;
  }
}
