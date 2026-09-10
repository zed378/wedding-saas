import type { SectionDefinition } from "../template/section.schema.js";
import { isPathMissing } from "./resolve-path.js";

/**
 * P0-20 — publish completeness (BR-4.2).
 *
 * `docs/BACKEND/03` § Validating Completeness for Publishing gives the algorithm:
 *
 * ```
 * for (const section of templateSections) {
 *   if (!isSectionEnabled(section, invitationData.settings)) continue;
 *   for (const fieldPath of section.required_fields) {
 *     if (isEmpty(resolvePath(invitationData, fieldPath))) missing.push(fieldPath);
 *   }
 * }
 * ```
 *
 * This is that, with the two things the pseudocode leaves to the reader made explicit:
 * what "enabled" means for a non-configurable section, and what "empty" means for a
 * wildcard path. Both are in `docs/` -- `docs/FRONTEND/04` step 2 and BR-4.2 -- and both
 * are the kind of detail that gets decided differently in two places if it is not
 * decided in one.
 */

/** A required field that is still empty, and the section that needs it. */
export interface MissingRequiredField {
  readonly sectionKey: string;
  readonly path: string;
}

/**
 * Is this section rendered for this invitation?
 *
 * `docs/FRONTEND/04` § Render Flow step 2: skip a section when `enabled_sections` does
 * not include its key, "unless `configurable: false`, in which case the section must
 * always show".
 *
 * The consequence for publish validation is the part worth stating: a non-configurable
 * section's required fields are checked **even when its key is absent from
 * `enabled_sections`**, because the user cannot turn that section off and it will be on
 * the published page regardless.
 */
export function isSectionEnabled(
  section: SectionDefinition,
  enabledSections: readonly string[],
): boolean {
  if (!section.configurable) return true;
  return enabledSections.includes(section.section_key);
}

/**
 * Every required field that is still empty, in section order then field order.
 *
 * Deterministic ordering matters: this list becomes `details[]` in a 422 and a checklist
 * in the editor, and a list that reshuffles between two identical requests looks like
 * the answer changed.
 *
 * The same path may appear twice if two enabled sections both require it. That is
 * information -- it says which sections are blocked -- and the caller dedupes for
 * display. Merging here would throw away the section, which is the half a user needs to
 * know where to go and fix it.
 */
export function collectMissingRequiredFields(
  sections: readonly SectionDefinition[],
  enabledSections: readonly string[],
  invitationData: unknown,
): readonly MissingRequiredField[] {
  const missing: MissingRequiredField[] = [];

  for (const section of sections) {
    if (!isSectionEnabled(section, enabledSections)) continue;

    for (const path of section.required_fields) {
      if (isPathMissing(invitationData, path)) {
        missing.push({ sectionKey: section.section_key, path });
      }
    }
  }

  return missing;
}

/** The distinct paths from `collectMissingRequiredFields`, first occurrence order. */
export function missingFieldPaths(
  missing: readonly MissingRequiredField[],
): readonly string[] {
  return [...new Set(missing.map((m) => m.path))];
}
