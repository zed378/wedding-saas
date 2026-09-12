import { COMPONENT_REGISTRY as SCHEMA_REGISTRY } from "@wi/schema";

import type { SectionComponent, SectionProps } from "./types.js";

/**
 * P2-02 step 2 — component name to React component.
 *
 * ## Two registries with one name, and they are not duplicates
 *
 * `@wi/schema`'s `COMPONENT_REGISTRY` maps a component name to the **section key** it may
 * render, and it is what the API validates a stored template against (`P0-20`). This one
 * maps the same names to **React components**. The backend cannot import React and the
 * renderer must not be the thing the API trusts, so they are necessarily separate — what
 * would be a defect is them disagreeing, and `registry.spec.tsx` asserts they do not, in
 * both directions. That is the parity test ADR-037 owes and `P2-02`'s DoD names.
 *
 * ## A breaking redesign is a NEW NAME
 *
 * `docs/PLAN/07` § Backward Compatibility, and it is the rule that makes stored templates
 * safe to keep: a version published two years ago names `GalleryGrid` explicitly, so
 * editing `GalleryGrid` changes what that invitation looks like without anyone touching
 * it. A redesign is `GalleryGridV2`, registered alongside. Nothing is ever removed from
 * this map while any stored version names it — `docs/PLAN/18` R5, and the parity test is
 * that risk's automated mitigation.
 *
 * ## These components are stand-ins
 *
 * `P2-03` builds the real ten. Until then each name resolves to a minimal component that
 * renders its section key and its data as text — enough for the core's own tests to prove
 * the render flow, the ordering, the theme and the modes, and deliberately not enough to
 * be mistaken for the finished library. Replacing them changes this file and nothing
 * else, which is the point of a registry.
 */

/**
 * The stand-in. One component, registered under every name.
 *
 * It renders a `data-section` attribute and a `data-component` attribute so a test can
 * assert **which** component rendered **which** section — the two things the render flow
 * decides — without depending on any visual detail that `P2-03` will change.
 */
function PlaceholderSection({
  data,
  layoutVariant,
  mode,
  maxItems,
}: SectionProps) {
  return (
    <div
      data-placeholder="true"
      {...(layoutVariant !== undefined
        ? { "data-layout-variant": layoutVariant }
        : {})}
      {...(maxItems !== undefined
        ? { "data-max-items": String(maxItems) }
        : {})}
      data-mode={mode}
    >
      {/*
       * As TEXT, never as HTML. React escapes this, which is what makes markup stored in
       * a name render as characters rather than as elements -- `P1-16` sanitizes on the
       * way in, and this is the layer that makes a miss there visible rather than
       * exploitable.
       */}
      {JSON.stringify(data)}
    </div>
  );
}

/**
 * Every name `@wi/schema` knows, mapped to a component.
 *
 * Built FROM the schema's list rather than written out again, so the two cannot drift by
 * omission while the stand-ins are in place. `P2-03` replaces this with an explicit map —
 * at which point drift becomes possible again, and the parity test is what catches it.
 */
export const COMPONENT_REGISTRY: Readonly<Record<string, SectionComponent>> =
  Object.freeze(
    Object.fromEntries(
      Object.keys(SCHEMA_REGISTRY).map((name) => [name, PlaceholderSection]),
    ),
  );

export function resolveComponent(name: string): SectionComponent | undefined {
  return Object.prototype.hasOwnProperty.call(COMPONENT_REGISTRY, name)
    ? COMPONENT_REGISTRY[name]
    : undefined;
}
