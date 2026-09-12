import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { templates, templateVersions } from "../../infra/db/schema/index";

/**
 * P2-01 — catalog reads.
 *
 * ## Published means published at both levels
 *
 * `docs/API/03` § Important Rules: the catalog returns only templates "whose version has
 * `status = published`". A template row can be published while every one of its versions
 * is still a draft — that is the normal state between an administrator creating a
 * template and releasing its first version — and such a template has nothing to render.
 * Every catalog query therefore requires a published version to exist, as an `EXISTS`
 * rather than a join: a join returns one row per published version, which would turn
 * three templates into seven on both the page and the count.
 *
 * BR-3.3 is the other half: a **deprecated** version stays renderable for invitations
 * already locked to it, and disappears from the catalog for new ones. Those are two
 * different questions, so they get two different methods — `findPublished*` for the
 * catalog and `findVersion` for an explicit request that may name a deprecated version.
 */

export interface TemplateRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly category: readonly string[];
  readonly isPremium: boolean;
  readonly thumbnailUrl: string | null;
}

export interface VersionRow {
  readonly id: string;
  readonly version: string;
  readonly sections: unknown;
  readonly theme: unknown;
  readonly customizableThemeKeys: readonly string[];
  readonly status: string;
  readonly releasedAt: Date | null;
}

export interface CatalogFilters {
  readonly category?: string | undefined;
  readonly search?: string | undefined;
  readonly isPremium?: boolean | undefined;
  readonly limit: number;
  readonly offset: number;
}

@Injectable()
export class TemplateRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * One page of the catalog, plus the total, plus each row's newest published sections.
   *
   * Two statements rather than one, deliberately. The obvious single query is
   * `DISTINCT ON (templates.id)` joined to versions — but `DISTINCT ON` requires the
   * leading `ORDER BY` to be the distinct expression, which forces the page to be ordered
   * by template id. A catalog ordered by uuid is not an ordering, it is a shuffle.
   *
   * So: page the templates on their own terms, then fetch the newest published version
   * for exactly the ids on that page. The second query is bounded by the page size, and
   * the sections it returns are what `supported_sections` is derived from — a card
   * showing a "Guestbook" badge for a template with no guestbook is the failure this
   * avoids.
   */
  async findPublishedPage(filters: CatalogFilters): Promise<{
    items: { template: TemplateRow; sections: unknown }[];
    total: number;
  }> {
    const predicate = this.#catalogPredicate(filters);

    const rows = await this.db
      .select({
        id: templates.id,
        slug: templates.slug,
        name: templates.name,
        category: templates.category,
        isPremium: templates.isPremium,
        thumbnailUrl: templates.thumbnailUrl,
      })
      .from(templates)
      .where(predicate)
      // Newest first, and `id` to break ties: without a total order, two pages of an
      // unstable sort can repeat a row and skip another.
      .orderBy(desc(templates.createdAt), desc(templates.id))
      .limit(filters.limit)
      .offset(filters.offset);

    const [totals] = await this.db
      .select({ total: count() })
      .from(templates)
      .where(predicate);

    if (rows.length === 0) {
      return { items: [], total: Number(totals?.total ?? 0) };
    }

    const sectionsById = await this.#newestPublishedSections(
      rows.map((r) => r.id),
    );

    return {
      items: rows.map((row) => ({
        template: row,
        sections: sectionsById.get(row.id),
      })),
      total: Number(totals?.total ?? 0),
    };
  }

  /**
   * The newest published version's sections, per template id.
   *
   * `DISTINCT ON` is exactly right here — the ordering it forces is the ordering this
   * query wants anyway.
   */
  async #newestPublishedSections(
    ids: readonly string[],
  ): Promise<Map<string, unknown>> {
    const rows = await this.db
      .selectDistinctOn([templateVersions.templateId], {
        templateId: templateVersions.templateId,
        sections: templateVersions.sections,
      })
      .from(templateVersions)
      .where(
        and(
          inArray(templateVersions.templateId, [...ids]),
          eq(templateVersions.status, "published"),
        ),
      )
      .orderBy(
        templateVersions.templateId,
        desc(templateVersions.releasedAt),
        desc(templateVersions.createdAt),
      );

    return new Map(rows.map((r) => [r.templateId, r.sections]));
  }

  /** The template and its newest published version, or `null` when either is missing. */
  async findPublishedBySlug(
    slug: string,
  ): Promise<{ template: TemplateRow; version: VersionRow } | null> {
    const [row] = await this.db
      .select({
        id: templates.id,
        slug: templates.slug,
        name: templates.name,
        category: templates.category,
        isPremium: templates.isPremium,
        thumbnailUrl: templates.thumbnailUrl,
        versionId: templateVersions.id,
        version: templateVersions.version,
        sections: templateVersions.sections,
        theme: templateVersions.theme,
        customizableThemeKeys: templateVersions.customizableThemeKeys,
        versionStatus: templateVersions.status,
        releasedAt: templateVersions.releasedAt,
      })
      .from(templates)
      .innerJoin(
        templateVersions,
        eq(templateVersions.templateId, templates.id),
      )
      .where(
        and(
          eq(templates.slug, slug),
          eq(templates.status, "published"),
          eq(templateVersions.status, "published"),
        ),
      )
      // Newest first. `released_at` rather than the version string, because semver does
      // not sort lexically -- '1.10.0' orders before '1.9.0' as text. A published version
      // always has `released_at` set; `created_at` breaks the tie for the impossible case
      // where two share a timestamp.
      .orderBy(
        desc(templateVersions.releasedAt),
        desc(templateVersions.createdAt),
      )
      .limit(1);

    if (row === undefined) return null;
    return { template: toTemplate(row), version: toVersion(row) };
  }

  /**
   * One specific version by number, whatever its status.
   *
   * Step 3 of the card: the demo and preview surfaces may ask for a deprecated version by
   * name. A **draft** version is still refused — it has never been released, and serving
   * one would let anyone with the URL preview unreleased work.
   */
  async findVersion(
    slug: string,
    version: string,
  ): Promise<{ template: TemplateRow; version: VersionRow } | null> {
    const [row] = await this.db
      .select({
        id: templates.id,
        slug: templates.slug,
        name: templates.name,
        category: templates.category,
        isPremium: templates.isPremium,
        thumbnailUrl: templates.thumbnailUrl,
        versionId: templateVersions.id,
        version: templateVersions.version,
        sections: templateVersions.sections,
        theme: templateVersions.theme,
        customizableThemeKeys: templateVersions.customizableThemeKeys,
        versionStatus: templateVersions.status,
        releasedAt: templateVersions.releasedAt,
      })
      .from(templates)
      .innerJoin(
        templateVersions,
        eq(templateVersions.templateId, templates.id),
      )
      .where(
        and(
          eq(templates.slug, slug),
          eq(templateVersions.version, version),
          // Published or deprecated, never draft.
          or(
            eq(templateVersions.status, "published"),
            eq(templateVersions.status, "deprecated"),
          ),
        ),
      )
      .limit(1);

    if (row === undefined) return null;
    return { template: toTemplate(row), version: toVersion(row) };
  }

  #catalogPredicate(filters: CatalogFilters) {
    const clauses = [
      eq(templates.status, "published"),
      // `docs/API/03`: a template appears only if it HAS a published version. An EXISTS
      // rather than a join, because a join would return one row per published version
      // and turn "three templates" into "seven" on both the page and the count.
      sql`EXISTS (
        SELECT 1 FROM ${templateVersions} v
        WHERE v.template_id = ${templates.id} AND v.status = 'published'
      )`,
    ];

    if (filters.category !== undefined) {
      // Array containment, so `?category=modern` matches a template tagged
      // `{modern,floral}`. A `=` on the whole array would only match a single-tag row.
      clauses.push(
        sql`${templates.category} @> ARRAY[${filters.category}]::varchar[]`,
      );
    }

    if (filters.search !== undefined) {
      // `docs/UI-UX/11`: "searching by name & category". `ilike` with the term escaped by
      // the driver's parameter binding -- the wildcards are ours, the term is data.
      const term = `%${escapeLike(filters.search)}%`;
      clauses.push(
        or(
          ilike(templates.name, term),
          sql`EXISTS (SELECT 1 FROM unnest(${templates.category}) AS c WHERE c ILIKE ${term})`,
        )!,
      );
    }

    if (filters.isPremium !== undefined) {
      clauses.push(eq(templates.isPremium, filters.isPremium));
    }

    return and(...clauses);
  }
}

/**
 * Neutralise the two characters `LIKE` treats as wildcards.
 *
 * Without this a search for `100%` matches every template, and a search for `_` matches
 * every single-character name. Not an injection — the value is still bound as a
 * parameter — but a user typing a literal character and getting pattern behaviour is a
 * bug, and on a large table it is a cheap way to force a full scan.
 */
function escapeLike(term: string): string {
  return term.replace(/([%_\\])/g, "\\$1");
}

interface JoinedRow {
  id: string;
  slug: string;
  name: string;
  category: string[];
  isPremium: boolean;
  thumbnailUrl: string | null;
  versionId: string;
  version: string;
  sections: unknown;
  theme: unknown;
  customizableThemeKeys: string[];
  versionStatus: string;
  releasedAt: Date | null;
}

const toTemplate = (row: JoinedRow): TemplateRow => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  category: row.category,
  isPremium: row.isPremium,
  thumbnailUrl: row.thumbnailUrl,
});

const toVersion = (row: JoinedRow): VersionRow => ({
  id: row.versionId,
  version: row.version,
  sections: row.sections,
  theme: row.theme,
  customizableThemeKeys: row.customizableThemeKeys,
  status: row.versionStatus,
  releasedAt: row.releasedAt,
});
