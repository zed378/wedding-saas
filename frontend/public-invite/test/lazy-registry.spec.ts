import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { COMPONENT_REGISTRY } from "@wi/template-renderer";

import {
  LAZY_SECTIONS,
  resolveLazySection,
} from "../src/components/Invitation";

/**
 * `P2-08` step 7 — the lazy registry, and the two guards it needs.
 *
 * The public page resolves component names through `next/dynamic` so a guest downloads
 * only the chunks their invitation's template reaches (`docs/FRONTEND/09` § Budget). That
 * means a **second** map from component names to components, and a second map is a second
 * thing that can fall behind the first.
 *
 * The failure it would cause is quiet and narrow: a template naming a component this map
 * forgot renders a section-shaped hole, on that template only, on a real wedding page.
 * Nobody would see it until somebody chose that template.
 *
 * This is the same parity discipline `registry.spec.tsx` applies between
 * `@wi/schema`'s component registry and the renderer's — ADR-037's, one layer further
 * out.
 */

describe("the lazy registry matches the renderer's", () => {
  it("covers every registered component", () => {
    const missing = Object.keys(COMPONENT_REGISTRY).filter(
      (name) => LAZY_SECTIONS[name] === undefined,
    );

    expect(missing).toEqual([]);
  });

  it("names no component the renderer does not have", () => {
    // The other direction. An entry here for a name nothing can render is dead code that
    // looks maintained, and usually means a component was renamed on one side only.
    const orphans = Object.keys(LAZY_SECTIONS).filter(
      (name) => COMPONENT_REGISTRY[name] === undefined,
    );

    expect(orphans).toEqual([]);
  });

  it("resolves a known name and refuses an unknown one", () => {
    expect(resolveLazySection("HeroClassic")).toBeDefined();
    expect(resolveLazySection("NotARealComponent")).toBeUndefined();
  });

  it("refuses a name inherited from Object.prototype", () => {
    // `LAZY_SECTIONS["toString"]` is a function on any plain object. A template naming
    // `constructor` would otherwise resolve to something React would try to render.
    expect(resolveLazySection("toString")).toBeUndefined();
    expect(resolveLazySection("constructor")).toBeUndefined();
  });
});

/**
 * `P2-08` step 5 and `docs/PLAN/18` R15.
 *
 * *"Serve **only** `/{slug}`, `/preview/{token}` and the proxied `/public/*` on this
 * host; everything else is a 404. With invitations at the root of the host, an unreserved
 * route would silently shadow a published invitation."*
 *
 * The danger is specific and one-directional: `/{slug}` is a dynamic segment, so **any**
 * new top-level route wins over it for that exact name. Adding `frontend/public-invite/src/app/about/`
 * would take the address `about` away from whoever published an invitation there, and the
 * only symptom is one couple's guests seeing the wrong page.
 *
 * A test rather than a review note, because the diff that causes it looks entirely
 * reasonable.
 */
describe("this host serves invitations and nothing else", () => {
  // `process.cwd()` rather than `import.meta.url`: Vitest rewrites module URLs, so
  // `new URL(".", import.meta.url)` is not a `file:` URL here. Vitest's root is the
  // package directory, which is what this needs anyway.
  const APP = join(process.cwd(), "src", "app");

  /** Routes that are allowed to exist, each with the reason it is not an invitation. */
  const ALLOWED = new Set([
    "[slug]", // the invitation itself
    "preview", // `P2-12`'s share-preview links, per docs/API/08
  ]);

  it("has no top-level route that could shadow a slug", () => {
    const directories = readdirSync(APP).filter((entry) =>
      statSync(join(APP, entry)).isDirectory(),
    );

    const shadowing = directories.filter((name) => !ALLOWED.has(name));

    expect(
      shadowing,
      "a top-level route directory takes that address away from any invitation published at it (R15). If the route is genuinely needed, add it to ALLOWED here with the reason, and add the name to the slug blocklist so nobody can publish at it.",
    ).toEqual([]);
  });
});
