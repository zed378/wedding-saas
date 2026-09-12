import type { CSSProperties } from "react";

import { resolveComponent } from "./registry.js";
import { resolveSectionData } from "./resolve-data.js";
import { mergeTheme, themeToCustomProperties } from "./theme.js";
import type {
  SectionDefinition,
  TemplateRendererProps,
  TemplateVersionDefinition,
} from "./types.js";

/**
 * P2-02 — the generic renderer. `docs/FRONTEND/04` § Render Flow.
 *
 * One component, used unchanged by the editor's live preview, the public page and the
 * catalogue demo. `CLAUDE.md`'s first non-negotiable in executable form: everything a
 * template needs is in `template_versions.sections`, and nothing here knows the name of a
 * single template.
 *
 * ## It makes no network call
 *
 * Data arrives as props, always. That is what lets the same component tree run under SSR
 * for `public-invite`, inside the editor against local state that has not been saved, and
 * on the demo against dummy data. A `fetch` anywhere in this package would end all three.
 *
 * ## What it deliberately does not do
 *
 * **No authorization.** The renderer is a pure function of its props and has no concept
 * of a user. `P2-07` decides what a guest may see and `P1-10` what an owner may; a
 * renderer that filtered by viewer would be a second authorization layer that the first
 * would eventually be trusted to have done.
 *
 * **No sanitization.** `P1-16` sanitizes on the way in. Every value here is rendered as
 * text by React, which escapes it — sanitizing again would suggest the server's sanitiser
 * is optional and would alter text that was legitimately stored.
 *
 * **No error boundary, yet.** `docs/FRONTEND/04` asks for one per section and `P2-04` is
 * its card. The structure here already wraps each section in its own element, so that
 * boundary drops in without a change of shape.
 */
export function TemplateRenderer({
  templateVersion,
  invitationData,
  enabledSections,
  themeOverride,
  mode,
  onSectionIssue,
}: TemplateRendererProps) {
  const theme = mergeTheme(
    templateVersion.theme,
    themeOverride,
    templateVersion.customizable_theme_keys ?? [],
  );

  // Step 5's theme, as CSS custom properties at the root. Components read
  // `var(--color-primary)`, so a theme change restyles the tree without re-rendering it.
  const style = themeToCustomProperties(theme) as CSSProperties;

  const visible = templateVersion.sections.filter((section) =>
    isVisible(section, enabledSections),
  );

  return (
    <div data-template-renderer="true" data-mode={mode} style={style}>
      {visible.map((section: SectionDefinition, index: number) => {
        const Component = resolveComponent(section.component);

        if (Component === undefined) {
          // `docs/PLAN/18` R5: a stored version naming a component that no longer exists.
          // The section is skipped and the rest of the page renders -- the alternative is
          // a blank invitation for one bad definition. The caller is told; this package
          // does not log.
          onSectionIssue?.({
            sectionKey: section.section_key,
            component: section.component,
            reason: "unregistered_component",
          });
          return null;
        }

        return (
          <section
            // The section key is not unique in principle -- `docs/PLAN/07` does not forbid
            // two `gallery` sections in one template -- so the index is part of the key.
            key={`${section.section_key}-${String(index)}`}
            data-section={section.section_key}
            data-component={section.component}
          >
            <Component
              data={resolveSectionData(invitationData, fieldsOf(section))}
              theme={theme}
              layoutVariant={section.layout_variant}
              mode={mode}
              maxItems={section.max_items}
            />
          </section>
        );
      })}
    </div>
  );
}

/**
 * Render flow step 2, and the exception in it.
 *
 * A section is shown when `enabled_sections` lists it — **unless** `configurable: false`,
 * in which case it always shows. `docs/FRONTEND/04` states that exception explicitly and
 * `P1-15` relies on it: the recompute there forces non-configurable sections on precisely
 * because they are not the user's to turn off.
 *
 * `enabledSections` being absent means "no settings supplied", which is the demo and
 * catalogue case. Then `enabled_by_default` decides — the template's own opinion, which
 * is exactly what a demo should show.
 */
function isVisible(
  section: SectionDefinition,
  enabledSections: readonly string[] | undefined,
): boolean {
  if (!section.configurable) return true;
  if (enabledSections === undefined) return section.enabled_by_default;
  return enabledSections.includes(section.section_key);
}

/**
 * The paths a section declared.
 *
 * Required and optional together: the distinction is about whether the *publish check*
 * refuses an empty value (`P2-06`), not about whether the component may see it.
 */
function fieldsOf(section: SectionDefinition): readonly string[] {
  return [
    ...(section.required_fields ?? []),
    ...(section.optional_fields ?? []),
  ];
}

/** Re-exported so a caller can type a definition without reaching into `types`. */
export type { TemplateVersionDefinition };
