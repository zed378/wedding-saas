import { describe, expect, it } from "vitest";
import {
  COMPONENT_NAMES,
  COMPONENT_REGISTRY as SCHEMA_REGISTRY,
} from "@wi/schema";

import { COMPONENT_REGISTRY, resolveComponent } from "./registry.js";

/**
 * P2-02 — the parity test ADR-037 owed since `P0-20`.
 *
 * ## What it is actually protecting
 *
 * The API validates a stored template's `component` against a list of **strings**. Until
 * this test existed, nothing anywhere proved those strings corresponded to code. A
 * template could pass validation, be published, be locked into an invitation by BR-3.1 —
 * and render nothing, because the name was never wired to a component.
 *
 * `docs/PLAN/18` R5 is that risk by name, and the card's DoD calls this its automated
 * mitigation: "a template version naming an unregistered component fails CI".
 *
 * ## Both directions, and the second one is not symmetry for its own sake
 *
 * A name in the schema with no component is the failure above. A component here with no
 * name in the schema is a different failure and a quieter one: it is code nothing can
 * ever reach, because the API would reject any template that named it. That is dead code
 * that looks alive, and it is how a "redesigned" component ends up shipped and unused
 * while every invitation keeps rendering the old one.
 */
describe("the two component registries agree", () => {
  it("has a component for every name the schema permits", () => {
    const missing = COMPONENT_NAMES.filter(
      (name) => resolveComponent(name) === undefined,
    );

    expect(
      missing,
      "these names pass API validation and would render nothing (docs/PLAN/18 R5)",
    ).toEqual([]);
  });

  it("registers no component the schema does not know", () => {
    const unknown = Object.keys(COMPONENT_REGISTRY).filter(
      (name) => !(name in SCHEMA_REGISTRY),
    );

    expect(
      unknown,
      "no stored template could ever name these, so they are unreachable code",
    ).toEqual([]);
  });

  it("covers all eleven names the reference template can draw on", () => {
    // A count assertion as well as the set comparisons: if both registries lost the same
    // name, the two tests above would still pass and the catalogue would quietly shrink.
    expect(Object.keys(COMPONENT_REGISTRY)).toHaveLength(
      COMPONENT_NAMES.length,
    );
    expect(COMPONENT_NAMES.length).toBeGreaterThanOrEqual(11);
  });

  it("answers undefined for a name nobody registered, rather than throwing", () => {
    expect(resolveComponent("GalleryGridV99")).toBeUndefined();
    // Prototype keys are not components. `resolveComponent("constructor")` returning
    // `Object` would make the renderer try to render it.
    expect(resolveComponent("constructor")).toBeUndefined();
    expect(resolveComponent("__proto__")).toBeUndefined();
  });

  it("is frozen, so nothing can register a component at runtime", () => {
    // A registry a caller could extend would let an application add a component the API
    // does not know about, which is the drift both tests above exist to prevent.
    expect(Object.isFrozen(COMPONENT_REGISTRY)).toBe(true);
  });
});
