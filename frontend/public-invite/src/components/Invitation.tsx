"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

import {
  TemplateRenderer,
  type SectionComponent,
  type SectionDefinition,
} from "@wi/template-renderer";
import type { SectionProps } from "@wi/template-renderer";

/**
 * `P2-08` steps 3 and 7 — the invitation, rendered through the shared renderer.
 *
 * ## Why a client component still satisfies "server-rendered"
 *
 * `"use client"` does not mean "rendered in the browser". Next renders this tree to HTML
 * on the server like any other component; the directive means it is **also** hydrated
 * afterwards. The initial HTML therefore carries the couple's names, the date and the
 * whole invitation, which is what `docs/FRONTEND/07` needs — a sharing bot scraping a
 * WhatsApp link never runs the hydration.
 *
 * The boundary exists because the sections are interactive: a cover gate, a countdown
 * ticking every second, a copy-account-number button, two form shells.
 *
 * ## Per-template loading: the mechanism is here, the split is not — yet
 *
 * `docs/FRONTEND/09` § Budget asks for *"section components loaded only for the active
 * template, not bundling every possible template"*, and every name below is a
 * `next/dynamic` import for exactly that reason.
 *
 * **It does not currently produce per-template chunks, and that was measured rather than
 * assumed.** Turbopack merges these eleven dynamic imports into a single chunk: a document
 * for a template with only a hero references an identical chunk list to one with every
 * section. The cost of the merge is the whole section library at about 7.5KB gzip, which
 * `initial-html.ssr.ts` pins with a failing test if it grows past 10KB.
 *
 * Left as it is deliberately. The saving available today is a few kilobytes of a 150KB
 * budget; the same code becomes worth revisiting when a second template family turns
 * eleven components into thirty, and `P2-13` owns the performance budget and the tooling
 * to do it with. Keeping the `dynamic` calls means the mechanism is in place and only the
 * bundler's chunking has to change.
 *
 * `ssr: true` throughout — the default, and stated rather than relied on, because the
 * alternative would empty the initial HTML and break the link preview this whole
 * application exists to produce.
 */

const lazy = (
  load: () => Promise<{ default: ComponentType<SectionProps> }>,
): SectionComponent => dynamic(load, { ssr: true });

const named = <K extends string>(
  load: () => Promise<Record<K, ComponentType<SectionProps>>>,
  key: K,
): SectionComponent => lazy(async () => ({ default: (await load())[key] }));

/**
 * Component name to a lazily-loaded component.
 *
 * Every key here must exist in `@wi/template-renderer`'s registry, and
 * `lazy-registry.spec.ts` asserts exactly that in both directions — a template naming a
 * component this map forgot would render a section-shaped hole on a real wedding page,
 * and the failure would only appear for templates using that one section.
 */
export const LAZY_SECTIONS: Readonly<Record<string, SectionComponent>> =
  Object.freeze({
    HeroClassic: named(
      () => import("@wi/template-renderer/sections/HeroClassic.js"),
      "HeroClassic",
    ),
    EventCardDouble: named(
      () => import("@wi/template-renderer/sections/EventCardDouble.js"),
      "EventCardDouble",
    ),
    QuoteBanner: named(
      () => import("@wi/template-renderer/sections/content-sections.js"),
      "QuoteBanner",
    ),
    CoupleProfile: named(
      () => import("@wi/template-renderer/sections/content-sections.js"),
      "CoupleProfile",
    ),
    GalleryGrid: named(
      () => import("@wi/template-renderer/sections/content-sections.js"),
      "GalleryGrid",
    ),
    GalleryCarousel: named(
      () => import("@wi/template-renderer/sections/content-sections.js"),
      "GalleryCarousel",
    ),
    MapsStatic: named(
      () => import("@wi/template-renderer/sections/content-sections.js"),
      "MapsStatic",
    ),
    GiftAccountList: named(
      () => import("@wi/template-renderer/sections/content-sections.js"),
      "GiftAccountList",
    ),
    ClosingSimple: named(
      () => import("@wi/template-renderer/sections/content-sections.js"),
      "ClosingSimple",
    ),
    RsvpForm: named(
      () => import("@wi/template-renderer/sections/interactive-shells.js"),
      "RsvpForm",
    ),
    GuestbookWall: named(
      () => import("@wi/template-renderer/sections/interactive-shells.js"),
      "GuestbookWall",
    ),
  });

export function resolveLazySection(name: string): SectionComponent | undefined {
  return Object.prototype.hasOwnProperty.call(LAZY_SECTIONS, name)
    ? LAZY_SECTIONS[name]
    : undefined;
}

export interface InvitationProps {
  readonly sections: readonly SectionDefinition[];
  readonly theme: Record<string, unknown>;
  readonly customizableThemeKeys: readonly string[];
  readonly data: Record<string, unknown>;
  readonly enabledSections: readonly string[];
  readonly themeOverride: Record<string, unknown> | undefined;
}

export function Invitation({
  sections,
  theme,
  customizableThemeKeys,
  data,
  enabledSections,
  themeOverride,
}: InvitationProps) {
  return (
    <TemplateRenderer
      mode="public"
      templateVersion={{
        sections,
        theme,
        customizable_theme_keys: customizableThemeKeys,
      }}
      invitationData={data}
      enabledSections={enabledSections}
      themeOverride={themeOverride}
      resolve={resolveLazySection}
      /*
       * No fallback, on purpose. `docs/FRONTEND/08` and `P2-04`: a guest who never knew
       * the gallery existed is not served by being told it failed — the editor shows the
       * couple a message because the couple can act on it, and a guest cannot.
       */
    />
  );
}
