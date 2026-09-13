/**
 * `P2-17` — regenerate the vendored region data from upstream.
 *
 *   node src/infra/db/seed-data/regions/import-regions.mts <wilayah.sql> <wilayah_level_1_2.sql>
 *
 * Source: https://github.com/cahyadsn/wilayah (MIT), `db/wilayah.sql` and
 * `db/wilayah_level_1_2.sql`. Both cite Kepmendagri No. 300.2.2-2138 Tahun 2025. See `NOTICE.md`
 * and `MEMORY/specs/P2-17-regions.md` for the verified counts.
 *
 * Writes, next to this file:
 *
 * - `regions.tsv` — `code<TAB>name`, every level, sorted by code.
 * - `regions-level-1-2.json` — capital, coordinates and zone for provinces and regencies.
 * - `boundaries.json` — province and regency boundaries, simplified, as rings of
 *   `[longitude, latitude]` with five decimals (about a metre).
 *
 * Refuses to write anything that fails the checks at the bottom — counts per level, code shapes,
 * every child's parent present, and every regency in its province's zone.
 *
 * ## Why rings are extracted by pattern
 *
 * Some upstream `path` values are not valid JSON: separate islands are concatenated without a
 * comma between them. Rather than repair strings, every `[[lat,lng],…]` run is taken as a ring,
 * and containment uses the even-odd rule across all of a region's rings — which also treats an
 * enclave ring as a hole, as it should.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [codesPath, levelPath] = process.argv.slice(2);
if (codesPath === undefined || levelPath === undefined) {
  console.error(
    "usage: import-regions.mts <wilayah.sql> <wilayah_level_1_2.sql>",
  );
  process.exit(2);
}

const HERE = import.meta.dirname;

/** Douglas-Peucker tolerance in degrees. 0.0005° is about 55 metres. */
const TOLERANCE = 0.0005;

const ZONES: Record<string, string> = {
  "7": "Asia/Jakarta",
  "8": "Asia/Makassar",
  "9": "Asia/Jayapura",
};

const unquote = (value: string): string => value.replaceAll("''", "'");

// --- Codes and names ------------------------------------------------------------------------
const codes = new Map<string, string>();
for (const m of readFileSync(codesPath, "utf8").matchAll(
  /\('([0-9.]+)','((?:[^']|'')*)'\)/g,
)) {
  codes.set(m[1]!, unquote(m[2]!).trim());
}

// --- Level 1 and 2 ------------------------------------------------------------------------
const levelRow =
  /\('([0-9.]+)','((?:[^']|'')*)',(?:'((?:[^']|'')*)'|NULL),\s*([-0-9.eE]+|NULL),\s*([-0-9.eE]+|NULL),\s*([-0-9.eE]+|NULL),\s*([-0-9]+|NULL),\s*([-0-9.eE]+|NULL),\s*([-0-9.eE]+|NULL),\s*(?:'([^']*)'|NULL),\s*([-0-9]+|NULL)\)/g;

type Point = [number, number];
const details: Record<
  string,
  {
    capital: string | null;
    latitude: number;
    longitude: number;
    timezone: string;
  }
> = {};
const boundaries: Record<string, Point[][]> = {};

for (const m of readFileSync(levelPath, "utf8").matchAll(levelRow)) {
  const code = m[1]!;
  const timezone = ZONES[m[7]!];
  if (timezone === undefined)
    throw new Error(`${code}: unknown UTC offset ${m[7]}`);
  details[code] = {
    capital: m[3] === undefined ? null : unquote(m[3]).trim(),
    latitude: round(Number(m[4]), 6),
    longitude: round(Number(m[5]), 6),
    timezone,
  };

  const rings: Point[][] = [];
  for (const ring of (m[10] ?? "").matchAll(
    /\[(\s*\[\s*-?[0-9.]+\s*,\s*-?[0-9.]+\s*\](?:\s*,\s*\[\s*-?[0-9.]+\s*,\s*-?[0-9.]+\s*\])*)\s*\]/g,
  )) {
    const points: Point[] = [
      ...ring[1]!.matchAll(/\[\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*\]/g),
    ].map(
      // Upstream order is [latitude, longitude]; stored as [longitude, latitude] (x, y).
      (p) => [Number(p[2]), Number(p[1])],
    );
    const simplified = simplify(points, TOLERANCE).map(
      ([x, y]) => [round(x, 5), round(y, 5)] as Point,
    );
    if (simplified.length >= 4) rings.push(simplified);
  }
  if (rings.length === 0) throw new Error(`${code}: no boundary ring`);
  boundaries[code] = rings;
}

// --- Checks -------------------------------------------------------------------------------
const levels = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<number, number>;
const shape = /^\d{2}(\.\d{2}(\.\d{2}(\.\d{4})?)?)?$/;
for (const code of codes.keys()) {
  if (!shape.test(code)) throw new Error(`malformed code ${code}`);
  const level = code.split(".").length;
  levels[level]! += 1;
  if (level > 1) {
    const parent = code.split(".").slice(0, -1).join(".");
    if (!codes.has(parent))
      throw new Error(`${code}: parent ${parent} missing`);
  }
}
const expected = { 1: 38, 2: 514, 3: 7285, 4: 83762 };
for (const [level, count] of Object.entries(expected)) {
  if (levels[Number(level)] !== count) {
    throw new Error(
      `level ${level}: ${levels[Number(level)]} rows, expected ${count}`,
    );
  }
}
for (const code of Object.keys(details)) {
  if (!codes.has(code))
    throw new Error(`${code}: in level-1-2 data but not in the code list`);
  if (
    code.length === 5 &&
    details[code]!.timezone !== details[code.slice(0, 2)]!.timezone
  ) {
    throw new Error(`${code}: zone differs from its province`);
  }
}
for (const code of codes.keys()) {
  if (code.split(".").length <= 2 && details[code] === undefined) {
    throw new Error(`${code}: no coordinates or boundary`);
  }
}

// --- Write --------------------------------------------------------------------------------
const sorted = [...codes.entries()].sort(([a], [b]) =>
  a < b ? -1 : a > b ? 1 : 0,
);
writeFileSync(
  join(HERE, "regions.tsv"),
  sorted.map(([code, name]) => `${code}\t${name}`).join("\n") + "\n",
);
writeFileSync(
  join(HERE, "regions-level-1-2.json"),
  JSON.stringify(details) + "\n",
);
writeFileSync(join(HERE, "boundaries.json"), JSON.stringify(boundaries) + "\n");

const points = Object.values(boundaries).reduce(
  (n, rings) => n + rings.reduce((m, r) => m + r.length, 0),
  0,
);
console.log(
  `regions: ${JSON.stringify(levels)}; boundaries: ${Object.keys(boundaries).length} regions, ${points} points`,
);

// --- Helpers ------------------------------------------------------------------------------
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Douglas-Peucker, iterative. Keeps the first and last point of a ring. */
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let index = -1;
    let furthest = 0;
    for (let i = first + 1; i < last; i += 1) {
      const d = distance(points[i]!, points[first]!, points[last]!);
      if (d > furthest) {
        furthest = d;
        index = i;
      }
    }
    if (index !== -1 && furthest > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

function distance([x, y]: Point, [x1, y1]: Point, [x2, y2]: Point): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(
    0,
    Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}
