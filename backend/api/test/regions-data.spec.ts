import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { kindOf } from "../src/infra/db/seed-data/regions/seed-regions.mts";
import {
  ancestorCodes,
  containsPoint,
  REGION_CODE,
  type Ring,
} from "../src/modules/regions/region-geometry";

/**
 * `P2-17` — the vendored region data and the pure rules over it, without a database.
 * `regions.itest.ts` proves the same counts after loading; this proves the files the seed reads.
 */

const DATA = join(__dirname, "../src/infra/db/seed-data/regions");
const rows = readFileSync(join(DATA, "regions.tsv"), "utf8")
  .trimEnd()
  .split("\n")
  .map((line) => line.split("\t") as [string, string]);
const boundaries = JSON.parse(
  readFileSync(join(DATA, "boundaries.json"), "utf8"),
) as Record<string, Ring[]>;

describe("the vendored region data", () => {
  it("has Kepmendagri 300.2.2-2138/2025's counts at every level", () => {
    const levels = [0, 0, 0, 0];
    for (const [code] of rows) levels[code.split(".").length - 1]! += 1;
    expect(levels).toEqual([38, 514, 7285, 83762]);
  });

  it("has only well-formed codes, each with its parent present", () => {
    // One assertion over collected failures: 91,599 rows times two `expect` calls took 21s
    // under `pnpm verify`'s parallel load and timed out.
    const codes = new Set(rows.map(([code]) => code));
    const problems: string[] = [];
    for (const [code, name] of rows) {
      if (!REGION_CODE.test(code)) problems.push(`${code}: malformed`);
      if (name.length === 0) problems.push(`${code}: no name`);
      for (const ancestor of ancestorCodes(code)) {
        if (!codes.has(ancestor))
          problems.push(`${code}: parent ${ancestor} missing`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("has a boundary for every province and regency", () => {
    const needed = rows
      .map(([code]) => code)
      .filter((code) => code.split(".").length <= 2);
    expect(needed.filter((code) => boundaries[code] === undefined)).toEqual([]);
  });

  it("carries the upstream MIT notice", () => {
    const notice = readFileSync(join(DATA, "NOTICE.md"), "utf8");
    expect(notice).toMatch(/MIT License/);
    expect(notice).toMatch(/Cahya DSN/);
  });
});

describe("kindOf", () => {
  it.each([
    ["51", "Bali", "provinsi"],
    ["51.03", "Kabupaten Badung", "kabupaten"],
    ["51.71", "Kota Denpasar", "kota"],
    ["51.71.01", "Denpasar Selatan", "kecamatan"],
    ["51.71.01.1001", "Sesetan", "kelurahan"],
    ["51.03.01.2001", "Pecatu", "desa"],
  ])("%s %s is a %s", (code, name, kind) => {
    expect(kindOf(code, name)).toBe(kind);
  });
});

describe("containsPoint", () => {
  const square: Ring = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  const hole: Ring = [
    [4, 4],
    [6, 4],
    [6, 6],
    [4, 6],
  ];
  const island: Ring = [
    [20, 20],
    [22, 20],
    [22, 22],
    [20, 22],
  ];

  it("treats every ring of a region with the even-odd rule: islands add, enclaves subtract", () => {
    expect(containsPoint([square, hole, island], 2, 2)).toBe(true);
    expect(containsPoint([square, hole, island], 5, 5)).toBe(false);
    expect(containsPoint([square, hole, island], 21, 21)).toBe(true);
    expect(containsPoint([square, hole, island], 15, 15)).toBe(false);
  });

  it("finds Denpasar in Bali's boundary and not in East Java's", () => {
    expect(containsPoint(boundaries["51"]!, 115.22, -8.65)).toBe(true);
    expect(containsPoint(boundaries["35"]!, 115.22, -8.65)).toBe(false);
  });
});
