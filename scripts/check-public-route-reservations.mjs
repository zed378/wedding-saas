import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export function unreservedPublicRoutes(root, seeds) {
  const reserved = new Set(
    seeds
      .filter((row) => row.match_type === "exact")
      .map((row) => row.term.toLowerCase()),
  );
  const routes = new Set();
  function walk(directory, segments = []) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const next =
          /^\(.+\)$/.test(entry.name) || entry.name.startsWith("@")
            ? segments
            : [...segments, entry.name];
        walk(join(directory, entry.name), next);
      } else if (/^(page|route)\.[cm]?[jt]sx?$/.test(entry.name)) {
        const first = segments[0];
        // Dynamic slug pages and non-slug paths (_next, robots.txt) cannot collide
        // with the lowercase alphanumeric invitation namespace.
        if (first && /^[a-z0-9][a-z0-9-]*$/.test(first)) routes.add(first);
      }
    }
  }
  walk(root);
  return [...routes].filter((route) => !reserved.has(route)).sort();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const missing = unreservedPublicRoutes(
    "frontend/public-invite/src/app",
    JSON.parse(
      readFileSync(
        "backend/api/src/infra/db/seed-data/slug-blocklist.json",
        "utf8",
      ),
    ),
  );
  if (missing.length) {
    console.error(`Unreserved public-host routes: ${missing.join(", ")}`);
    process.exitCode = 1;
  } else
    console.log(
      "check-public-route-reservations: all static public routes have exact seeded reservations.",
    );
}
