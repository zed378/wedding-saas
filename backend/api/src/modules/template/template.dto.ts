import { SECTION_KEYS, type SectionKey } from "@wi/schema";

import type { TemplateRow, VersionRow } from "./template.repository";

/**
 * P2-01 — the catalog's response shapes. `docs/API/03` § Example Response.
 *
 * Explicit DTOs rather than returning rows, for the reason `docs/SECURITY/05` § 5 gives
 * about response filtering: a shape assembled field by field cannot grow a column
 * somebody adds to the table later. `templates.status` is the obvious example — it is
 * how the catalog decides what to show and is not the catalog's business to publish.
 */

export interface TemplateSummaryDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly category: readonly string[];
  readonly is_premium: boolean;
  readonly thumbnail_url: string | null;
  /** `docs/UI-UX/11`: the badge list, so a card can show capabilities before a click. */
  readonly supported_sections: readonly SectionKey[];
}

export interface TemplateVersionDto {
  readonly id: string;
  readonly version: string;
  readonly sections: unknown;
  readonly theme: unknown;
  readonly customizable_theme_keys: readonly string[];
  /**
   * Present so a preview surface can say so. Absent from `docs/API/03`'s example because
   * that example is the catalog's own read, where it is always `published`.
   */
  readonly status: string;
}

export interface TemplateDetailDto extends TemplateSummaryDto {
  readonly current_version: TemplateVersionDto;
}

/**
 * Which sections a template version offers, in the canonical order.
 *
 * Derived from the definition rather than stored: a second column would be one more
 * thing to keep in step with `sections`, and the two disagreeing is exactly the kind of
 * mismatch that shows a user a "Guestbook" badge on a template that has no guestbook.
 *
 * `SECTION_KEYS` order rather than the template's own, because this is a badge list read
 * left to right — a user comparing two templates should find the same badge in the same
 * place, not in whatever order an administrator happened to author the sections.
 */
export function supportedSections(sections: unknown): SectionKey[] {
  if (!Array.isArray(sections)) return [];

  const present = new Set<string>();
  for (const section of sections) {
    const key = (section as { section_key?: unknown } | null)?.section_key;
    if (typeof key === "string") present.add(key);
  }

  return SECTION_KEYS.filter((key) => present.has(key));
}

export function toSummary(
  row: TemplateRow,
  sections: unknown,
): TemplateSummaryDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    is_premium: row.isPremium,
    thumbnail_url: row.thumbnailUrl,
    supported_sections: supportedSections(sections),
  };
}

export function toDetail(
  template: TemplateRow,
  version: VersionRow,
): TemplateDetailDto {
  return {
    ...toSummary(template, version.sections),
    current_version: {
      id: version.id,
      version: version.version,
      sections: version.sections,
      theme: version.theme,
      customizable_theme_keys: version.customizableThemeKeys,
      status: version.status,
    },
  };
}
