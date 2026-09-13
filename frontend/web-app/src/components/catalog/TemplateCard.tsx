import Link from "next/link";

import { Badge } from "@wi/ui";
import { sectionLabel } from "@wi/schema";

import type { TemplateSummary } from "../../lib/catalog-api";

/**
 * `P2-11` step 1 — one template in the catalogue grid. `docs/UI-UX/11` § Catalog Page.
 *
 * ## The whole card is one link
 *
 * A heading link stretched over the card with `after:absolute` rather than an `<a>` wrapping
 * a heading, a paragraph and an image. A link wrapping block content is announced by a
 * screen reader as one long run-on name — "Elegant Rose modern floral Premium Sampul
 * Mempelai …" — and a guest tabbing through twelve cards hears twelve of those.
 *
 * ## The section badges are labels, never keys
 *
 * `supported_sections` is `["hero", "couple", …]`. Rendering those strings would put
 * English identifiers on an Indonesian page, and `check-no-hardcoded-fields` forbids a
 * section key in a component anyway. `sectionLabel` from `@wi/schema` is the same table the
 * editor's publish checklist uses (`P2-06`), so a section is called the same thing in both
 * places.
 */
export function TemplateCard({
  template,
}: {
  readonly template: TemplateSummary;
}) {
  return (
    <li className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface-raised focus-within:ring-2 focus-within:ring-primary-600">
      {template.thumbnail_url === null ? (
        <div
          aria-hidden="true"
          className="aspect-[3/4] w-full bg-surface-sunken"
        />
      ) : (
        <img
          src={template.thumbnail_url}
          // Decorative here: the name is the card's accessible name, and "thumbnail of Elegant
          // Rose" read before "Elegant Rose" says the same thing twice.
          alt=""
          loading="lazy"
          decoding="async"
          className="aspect-[3/4] w-full object-cover"
        />
      )}

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-medium text-text">
            <Link
              href={`/templates/${encodeURIComponent(template.slug)}`}
              className="after:absolute after:inset-0 focus:outline-none"
            >
              {template.name}
            </Link>
          </h2>
          {template.is_premium && <Badge tone="premium">Premium</Badge>}
        </div>

        {template.category.length > 0 && (
          <p className="text-sm text-text-muted">
            {template.category.join(" · ")}
          </p>
        )}

        {template.supported_sections.length > 0 && (
          <p className="mt-auto text-xs text-text-muted">
            <span className="sr-only">Bagian yang tersedia: </span>
            {template.supported_sections.map(sectionLabel).join(", ")}
          </p>
        )}
      </div>
    </li>
  );
}
