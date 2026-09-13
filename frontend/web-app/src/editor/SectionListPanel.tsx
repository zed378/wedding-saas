"use client";

import {
  collectMissingRequiredFields,
  type SectionDefinition,
} from "@wi/schema";

import { useEditor, useEditorContext } from "./EditorProvider";

/**
 * P1-22 step 7 — the section list. `docs/UI-UX/10` § SectionListItem.
 *
 * Three things per row, and each is specified: the name, a toggle **only when the template
 * says `configurable: true`**, and an incomplete indicator when a `required_field` is empty.
 *
 * ## The incomplete dot is not decoration either
 *
 * BR-4.2 blocks publishing while a required field is empty, and `P2-06` builds that check.
 * Showing it here is what stops a user discovering, at the moment they try to publish, that
 * four sections they thought were finished are not. `docs/UI-UX/08` § Contrast: it is never
 * only a red dot — the count is in the accessible name too.
 */

export function SectionListPanel() {
  const definition = useEditor((s) => s.templateDefinition);
  const data = useEditor((s) => s.data);
  const active = useEditor((s) => s.activeSectionKey);
  const setActiveSection = useEditor((s) => s.setActiveSection);
  const setEnabledSections = useEditor((s) => s.setEnabledSections);
  const { edit } = useEditorContext();

  if (definition === undefined) return null;

  const enabled = new Set(definition.enabledSections);

  const toggle = (key: string, on: boolean) => {
    const next = new Set(enabled);
    if (on) next.add(key);
    else next.delete(key);

    const keys = definition.sections
      .map((s) => s.section_key)
      .filter((k) => next.has(k));

    // Both: the store so the preview reacts at once, and the edit path so it is queued for
    // the settings endpoint. Calling only the first would make the toggle a lie that
    // survives until a reload.
    setEnabledSections(keys);
    edit("settings.enabled_sections", keys);
  };

  return (
    <nav aria-label="Bagian undangan" className="h-full overflow-y-auto p-2">
      <ul className="space-y-1">
        {definition.sections.map((section) => {
          const missing = missingRequired(
            section,
            definition.enabledSections,
            data,
          );
          const isActive = active === section.section_key;
          const isOn = enabled.has(section.section_key);

          return (
            <li key={section.section_key}>
              <div
                className={
                  isActive
                    ? "flex items-center justify-between gap-2 rounded-md bg-primary-50 px-2"
                    : "flex items-center justify-between gap-2 rounded-md px-2"
                }
              >
                <button
                  type="button"
                  // `aria-current` rather than a class alone: which section is open is
                  // information, and a colour is not information to everyone.
                  aria-current={isActive ? "true" : undefined}
                  className="focus-ring flex min-h-11 flex-1 items-center gap-2 text-left text-sm font-medium text-text"
                  onClick={() => {
                    setActiveSection(section.section_key);
                  }}
                >
                  <span className="truncate">{section.section_key}</span>

                  {missing > 0 && (
                    <>
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-full bg-danger-600"
                      />
                      {/* The dot's meaning, for anybody who cannot see it. */}
                      <span className="sr-only">
                        {`${String(missing)} isian wajib belum lengkap`}
                      </span>
                    </>
                  )}
                </button>

                {section.configurable === true && (
                  <label className="flex min-h-11 items-center gap-2 text-xs text-text-muted">
                    <input
                      type="checkbox"
                      className="focus-ring h-4 w-4"
                      checked={isOn}
                      onChange={(e) => {
                        toggle(section.section_key, e.target.checked);
                      }}
                    />
                    {/* Visible label text, so the control is not a bare checkbox. */}
                    <span>Tampilkan</span>
                  </label>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * How many of a section's `required_fields` are still empty.
 *
 * Empty means absent, `null`, or a string of only whitespace — `"   "` is not a name, and a
 * check that accepted it would let somebody publish an invitation with a blank hero and a
 * green tick beside it.
 */
/**
 * How many of a section's required fields are still empty.
 *
 * `P1-22` implemented the emptiness rule here by hand, because `P2-06` did not exist yet.
 * It now delegates to `collectMissingRequiredFields` — the same function the publish check
 * and `POST /publish` run (`P0-20`, shared through `@wi/schema`).
 *
 * That matters more than the duplication: a sidebar that disagreed with the publish check
 * about what is complete would show a finished section next to a button refusing to
 * publish it, and the user has no way to tell which one is wrong.
 *
 * The section is passed whole rather than as a field list, because enablement is part of
 * the rule and only the section knows it.
 */
export function missingRequired(
  section: {
    readonly section_key: string;
    readonly required_fields?: readonly string[];
    readonly configurable?: boolean;
  },
  enabledSections: readonly string[],
  data: Readonly<Record<string, unknown>>,
): number {
  return collectMissingRequiredFields(
    [
      {
        section_key: section.section_key,
        component: "",
        enabled_by_default: true,
        configurable: section.configurable ?? true,
        required_fields: section.required_fields ?? [],
        optional_fields: [],
      } as unknown as SectionDefinition,
    ],
    enabledSections,
    data,
  ).length;
}
