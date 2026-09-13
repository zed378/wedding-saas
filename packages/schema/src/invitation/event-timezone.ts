/**
 * `P2-16`, ADR-070 — the timezone an event happens in. `OQ-27`, answered by the project owner
 * on 2026-09-13: detect it from the event's map pin, and let the couple choose it in the form.
 *
 * Indonesia has three zones and no daylight saving, so a zone is a fixed offset:
 *
 *   WIB  `Asia/Jakarta`   +07:00  Sumatra, Java, West and Central Kalimantan
 *   WITA `Asia/Makassar`  +08:00  Bali, Nusa Tenggara, South/East/North Kalimantan, Sulawesi
 *   WIT  `Asia/Jayapura`  +09:00  Maluku, North Maluku, Papua
 *
 * Until `P2-16` every event was treated as WIB: labelled "WIB" and counted down to `+07:00`,
 * so a wedding in Denpasar showed the wrong zone and a countdown that reached zero an hour late.
 *
 * Lives in `@wi/schema` because the API (a default when the client sends coordinates but no
 * zone) and the editor (filling the field when a pin is dropped) must agree.
 */

export const EVENT_TIMEZONES = [
  { value: "Asia/Jakarta", abbreviation: "WIB", offset: "+07:00" },
  { value: "Asia/Makassar", abbreviation: "WITA", offset: "+08:00" },
  { value: "Asia/Jayapura", abbreviation: "WIT", offset: "+09:00" },
] as const;

export type EventTimezone = (typeof EVENT_TIMEZONES)[number]["value"];

export const DEFAULT_EVENT_TIMEZONE: EventTimezone = "Asia/Jakarta";

export const EVENT_TIMEZONE_VALUES: readonly EventTimezone[] =
  EVENT_TIMEZONES.map((zone) => zone.value);

export function isEventTimezone(value: unknown): value is EventTimezone {
  return (
    typeof value === "string" &&
    (EVENT_TIMEZONE_VALUES as readonly string[]).includes(value)
  );
}

/** `WIB`, `WITA` or `WIT`; the default zone's for anything unrecognised. */
export function timezoneAbbreviation(value: unknown): string {
  return (
    EVENT_TIMEZONES.find((zone) => zone.value === value) ?? EVENT_TIMEZONES[0]
  ).abbreviation;
}

/** `+07:00`, `+08:00` or `+09:00`; the default zone's for anything unrecognised. */
export function timezoneOffset(value: unknown): string {
  return (
    EVENT_TIMEZONES.find((zone) => zone.value === value) ?? EVENT_TIMEZONES[0]
  ).offset;
}

/**
 * The zone a map pin falls in, or `undefined` outside the archipelago's bounding box.
 *
 * **Not a country test.** A pin in a neighbouring country inside that box — Singapore, Kuala
 * Lumpur, Kuching — is given the nearest Indonesian rule's zone. Excluding them would also
 * exclude Sumatran towns on the Malacca Strait, and a wedding abroad sets the field by hand.
 *
 * **An approximation, and the form field always wins.** The real boundaries are province
 * lines, and two of them run close to other land: the Bali Strait puts Banyuwangi (WIB) and
 * Gilimanuk (WITA) a few kilometres apart, and the Kalimantan split follows the Central/South
 * Kalimantan border rather than a meridian. The rules below are drawn to get every city and
 * port in `event-timezone.spec.ts` right, including those border pairs; a pin in open country
 * right on a provincial line can still be wrong, which is why the editor shows the result as
 * a choice the couple can change rather than a fact.
 */
export function timezoneForCoordinates(
  latitude: number,
  longitude: number,
): EventTimezone | undefined {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
    return undefined;
  if (
    longitude < 94 ||
    longitude > 141.1 ||
    latitude < -11.2 ||
    latitude > 6.3
  ) {
    return undefined;
  }

  // --- WIT: Maluku, North Maluku and Papua lie east of ~124.2°E -------------------------
  // Two WITA exceptions reach past that meridian: North Sulawesi's tip and its Sangihe and
  // Talaud islands, and East Nusa Tenggara's Alor. Wetar and Kisar, just east of Alor, are
  // Maluku's.
  const northSulawesi =
    longitude <= 127.1 && latitude >= 0.3 && latitude <= 5.6;
  const eastNusaTenggara = longitude <= 125.3 && latitude <= -7.8;
  if (longitude >= 124.2 && !northSulawesi && !eastNusaTenggara) {
    return "Asia/Jayapura";
  }

  // --- The Java–Bali–Nusa Tenggara band ----------------------------------------------------
  // South of 7.6°S: Java's south and east against Bali and the islands beyond, split at the
  // Bali Strait. Between 6.5°S and 7.6°S: Java's north coast, Madura and the Kangean islands
  // (all East Java, WIB), which reach further east than Bali does.
  if (latitude < -7.6)
    return longitude < 114.41 ? "Asia/Jakarta" : "Asia/Makassar";
  if (latitude < -6.5)
    return longitude < 116 ? "Asia/Jakarta" : "Asia/Makassar";

  // --- Kalimantan: West and Central are WIB ----------------------------------------------
  if (insidePolygon(longitude, latitude, WEST_AND_CENTRAL_KALIMANTAN)) {
    return "Asia/Jakarta";
  }

  // --- The rest of the west ----------------------------------------------------------------
  if (longitude < 108) return "Asia/Jakarta"; // Sumatra, Riau, Bangka, western Java
  if (longitude < 109.5 && latitude > 2.2) return "Asia/Jakarta"; // Natuna, Anambas
  if (latitude < -4 && longitude < 114) return "Asia/Jakarta"; // Bawean, Karimunjawa

  return "Asia/Makassar";
}

/**
 * West and Central Kalimantan, with Belitung, as `[longitude, latitude]` — simplified.
 *
 * The eastern edge follows the Central Kalimantan border: Kuala Kapuas and Muara Teweh fall
 * inside, Banjarmasin and Long Apari (Mahakam Ulu) outside.
 */
const WEST_AND_CENTRAL_KALIMANTAN: readonly (readonly [number, number])[] = [
  [108.0, 2.2],
  [111.0, 1.6],
  [113.7, 1.3],
  [113.9, 0.4],
  [114.7, -0.3],
  [115.5, -0.9],
  [115.4, -1.9],
  [114.9, -2.5],
  [114.55, -3.3],
  [114.45, -4.0],
  [108.0, -4.0],
];

/** Ray casting. */
function insidePolygon(
  x: number,
  y: number,
  polygon: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
