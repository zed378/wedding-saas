import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error JavaScript gate intentionally has no declaration file.
import { unreservedPublicRoutes } from "../../../scripts/check-public-route-reservations.mjs";

describe("P5-13 public route reservation gate", () => {
  it("rejects a newly introduced route until exact seeded reservation exists", () => {
    const root = mkdtempSync(join(tmpdir(), "wi-route-gate-"));
    try {
      for (const route of [
        "preview/[token]",
        "public/i/[slug]",
        "[slug]",
        "(group)/pricing",
        "@modal/(group)/support",
      ]) {
        mkdirSync(join(root, route), { recursive: true });
        writeFileSync(join(root, route, "page.tsx"), "");
      }
      const seeds = [
        { term: "preview", match_type: "exact" },
        { term: "public", match_type: "exact" },
        { term: "pricing", match_type: "substring" },
      ];
      expect(unreservedPublicRoutes(root, seeds)).toEqual([
        "pricing",
        "support",
      ]);
      expect(
        unreservedPublicRoutes(root, [
          ...seeds,
          { term: "pricing", match_type: "exact" },
          { term: "support", match_type: "exact" },
        ]),
      ).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
