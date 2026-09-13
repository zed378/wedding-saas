/**
 * `P2-17` — is a point inside a region's boundary?
 *
 * Rings are `[longitude, latitude]` pairs. Containment is the even-odd rule across **all** of a
 * region's rings: a province of many islands is many rings, and a ring inside another (an enclave)
 * correctly cancels it. The upstream data encodes both cases the same way, so the rule has to
 * handle both without being told which is which.
 */
export type Ring = readonly (readonly [number, number])[];

export function containsPoint(
  rings: readonly Ring[],
  longitude: number,
  latitude: number,
): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (
        yi > latitude !== yj > latitude &&
        longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** A Kemendagri code's ancestors, nearest last: `11.01.01` → `["11", "11.01"]`. */
export function ancestorCodes(code: string): string[] {
  const parts = code.split(".");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("."));
}

export const REGION_CODE = /^\d{2}(\.\d{2}(\.\d{2}(\.\d{4})?)?)?$/;
