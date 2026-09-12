import type { SectionComponent } from "./types.js";
import { HeroClassic } from "./sections/HeroClassic.js";
import { EventCardDouble } from "./sections/EventCardDouble.js";
import {
  ClosingSimple,
  CoupleProfile,
  GalleryCarousel,
  GalleryGrid,
  GiftAccountList,
  MapsStatic,
  QuoteBanner,
} from "./sections/content-sections.js";
import { GuestbookWall, RsvpForm } from "./sections/interactive-shells.js";

/**
 * P2-02 step 2, P2-03 — component name to React component.
 *
 * ## Two registries with one name, and they are not duplicates
 *
 * `@wi/schema`'s `COMPONENT_REGISTRY` maps a component name to the **section key** it may
 * render, and it is what the API validates a stored template against (`P0-20`). This one
 * maps the same names to **React components**. The backend cannot import React and the
 * renderer must not be the thing the API trusts, so they are necessarily separate — what
 * would be a defect is them disagreeing, and `registry.spec.tsx` asserts they do not, in
 * both directions. That is the parity test ADR-037 owed.
 *
 * `P2-02` built this map FROM the schema's keys while the components were stand-ins, so
 * drift was impossible by construction. It is now written out explicitly, because each
 * name resolves to a different component — which means drift is possible again, and the
 * parity test stops being belt and braces and becomes the only thing holding.
 *
 * ## A breaking redesign is a NEW NAME
 *
 * `docs/PLAN/07` § Backward Compatibility, and it is the rule that makes stored templates
 * safe to keep: a version published two years ago names `GalleryGrid` explicitly, so
 * editing `GalleryGrid` changes what that invitation looks like without anyone touching
 * it. A redesign is `GalleryGridV2`, registered alongside. Nothing is ever removed from
 * this map while any stored version names it — `docs/PLAN/18` R5.
 */
export const COMPONENT_REGISTRY: Readonly<Record<string, SectionComponent>> =
  Object.freeze({
    HeroClassic,
    CoupleProfile,
    QuoteBanner,
    EventCardDouble,
    GalleryGrid,
    GalleryCarousel,
    MapsStatic,
    GiftAccountList,
    RsvpForm,
    GuestbookWall,
    ClosingSimple,
  });

export function resolveComponent(name: string): SectionComponent | undefined {
  return Object.prototype.hasOwnProperty.call(COMPONENT_REGISTRY, name)
    ? COMPONENT_REGISTRY[name]
    : undefined;
}
