import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `P2-14` step 6 — every parameterised route is either in the IDOR sweep or exempt for a
 * stated reason.
 *
 * `idor-sweep.itest.ts` (`P1-25`) proves each route it lists answers a non-owner with 404. It
 * cannot prove it lists every route: a new `:id` endpoint missing from `CASES` is simply not
 * tested, and nothing fails. `P2-14` checked the Phase 2 routes by hand and found all four in
 * the sweep — this makes that check mechanical, so the next phase's routes cannot be missed.
 *
 * Read from the controllers' own decorators rather than from a list, because a list is what
 * would drift.
 */

const SRC = join(__dirname, "..", "src");
const SWEEP = join(__dirname, "integration", "idor-sweep.itest.ts");

/**
 * Parameterised routes that are deliberately NOT owner-scoped, each with the test that owns
 * their access rule instead. Adding a route here is a claim that needs that test.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  "GET /public/i/:slug":
    "public by design; the status predicate is the rule — public-invitation.itest.ts › 'answers a draft, an unpublished, an expired and a deleted invitation identically…'",
  "GET /public/preview/:token":
    "a bearer credential, not an owner route — preview-link.itest.ts › 'answers expired, revoked, invented, malformed and deleted-invitation tokens identically'",
  "GET /api/v1/templates/:slug":
    "the public catalogue (ADR-059) — template-catalog.itest.ts",
  "GET /api/v1/templates/:slug/versions/:version":
    "the public catalogue (ADR-059) — template-catalog.itest.ts",
  "GET /api/v1/regions/:code":
    "public reference data with no tenant: Indonesia's administrative regions (P2-17) — regions.itest.ts › 'returns a village with its province, regency and district'",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

/** `METHOD /prefix/path` for every decorated handler whose path has a parameter. */
function parameterisedRoutes(): { route: string; file: string }[] {
  const routes: { route: string; file: string }[] = [];

  for (const file of files(SRC).filter((f) => f.endsWith(".controller.ts"))) {
    if (file.includes(`${join("modules", "_reference")}`)) continue;
    const source = readFileSync(file, "utf8");
    const prefix = /@Controller\(\s*"([^"]*)"\s*\)/.exec(source)?.[1] ?? "";

    for (const match of source.matchAll(
      /@(Get|Post|Patch|Put|Delete)\(\s*"([^"]*)"\s*\)/g,
    )) {
      const path = `/${[prefix, match[2]].filter(Boolean).join("/")}`.replace(
        /\/+/g,
        "/",
      );
      if (!path.includes(":")) continue;
      routes.push({
        route: `${match[1]!.toUpperCase()} ${path}`,
        file: relative(join(__dirname, ".."), file),
      });
    }
  }
  return routes;
}

/** The sweep's labels omit `/api/v1`; a concrete segment (`groom`) covers a parameter (`:role`). */
function covered(route: string, labels: readonly string[]): boolean {
  const [method, path] = route.split(" ") as [string, string];
  const segments = path.replace(/^\/api\/v1/, "").split("/");
  return labels.some((label) => {
    const [labelMethod, labelPath] = label.split(" ") as [string, string];
    const labelSegments = labelPath.split("/");
    return (
      labelMethod === method &&
      labelSegments.length === segments.length &&
      segments.every(
        (segment, index) =>
          segment === labelSegments[index] ||
          (segment.startsWith(":") && labelSegments[index] !== undefined),
      )
    );
  });
}

describe("the IDOR sweep covers every parameterised route", () => {
  const labels = [
    ...readFileSync(SWEEP, "utf8").matchAll(/label:\s*"([A-Z]+ [^"]+)"/g),
  ].map((m) => m[1]!);
  const routes = parameterisedRoutes();

  it("finds the routes and the sweep's cases to compare", () => {
    // Negative control: a regex that matched nothing would pass the next test vacuously.
    expect(routes.length).toBeGreaterThanOrEqual(25);
    expect(labels.length).toBeGreaterThanOrEqual(25);
  });

  it("has no parameterised route that is neither swept nor exempt", () => {
    const missing = routes
      .filter(
        ({ route }) => EXEMPT[route] === undefined && !covered(route, labels),
      )
      .map(({ route, file }) => `${route}  (${file})`);

    expect(missing).toEqual([]);
  });

  it("has no exemption for a route that no longer exists", () => {
    const existing = new Set(routes.map((r) => r.route));
    expect(Object.keys(EXEMPT).filter((route) => !existing.has(route))).toEqual(
      [],
    );
  });
});
