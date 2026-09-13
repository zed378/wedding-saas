"use client";

import {
  TemplateRenderer,
  type SectionDefinition,
} from "@wi/template-renderer";
import { sectionLabel } from "@wi/schema";

/**
 * `P2-11` step 2 — the per-section carousel. `docs/UI-UX/11` § Template Detail Page.
 *
 * *"A carousel of screenshots per section (Hero, Couple, Gallery, etc.) — giving a realistic
 * impression, NOT just a single thumbnail."*
 *
 * ## Rendered sections, not screenshots
 *
 * There are no screenshots in the data model — `templates` carries one `thumbnail_url`.
 * Producing per-section images would mean an asset pipeline that re-shoots every template
 * whenever a section component changes, and a screenshot is precisely the thing that stops
 * matching the product the first time it does.
 *
 * So each slide is the real section, drawn by the production renderer in `demo` mode, from
 * the seeded demo invitation's public payload (`docs/PLAN/07` § Demo Data). It cannot be out
 * of date, because there is nothing to regenerate.
 *
 * ## Contained, and inert
 *
 * Each preview sits in a fixed-height, overflow-hidden frame, and is `inert`: the countdown
 * still ticks, but a visitor cannot tab into a demo's copy button or form shell from the
 * catalogue. The carousel itself is a scroll-snapping list, reachable by keyboard because
 * the list is focusable, and each slide is named by its section.
 */

export interface SectionPreviewsProps {
  readonly sections: readonly SectionDefinition[];
  readonly theme: Record<string, unknown>;
  readonly customizableThemeKeys: readonly string[];
  readonly data: Record<string, unknown>;
  readonly enabledSections: readonly string[];
}

export function SectionPreviews({
  sections,
  theme,
  customizableThemeKeys,
  data,
  enabledSections,
}: SectionPreviewsProps) {
  const shown = sections.filter(
    (section) =>
      !section.configurable || enabledSections.includes(section.section_key),
  );

  if (shown.length === 0) return null;

  return (
    <section aria-labelledby="section-previews" className="flex flex-col gap-3">
      <h2 id="section-previews" className="text-lg font-semibold text-text">
        Pratinjau per bagian
      </h2>

      <ul
        // Focusable so a keyboard can scroll it; a scroll container with no focusable
        // children is otherwise unreachable without a mouse or a touch screen.
        tabIndex={0}
        aria-label="Pratinjau bagian template, geser untuk melihat"
        className="focus-ring flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2"
      >
        {shown.map((section, index) => (
          <li
            key={`${section.section_key}-${String(index)}`}
            className="flex w-72 shrink-0 snap-start flex-col gap-2"
          >
            <div
              inert
              className="h-96 overflow-hidden rounded-lg border border-border bg-surface"
            >
              <TemplateRenderer
                mode="demo"
                templateVersion={{
                  sections: [section],
                  theme,
                  customizable_theme_keys: customizableThemeKeys,
                }}
                invitationData={data}
                // One section at a time, shown whatever the demo's settings say: the
                // slide exists to show this section.
                enabledSections={[section.section_key]}
              />
            </div>
            <p className="text-sm font-medium text-text">
              {sectionLabel(section.section_key)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
