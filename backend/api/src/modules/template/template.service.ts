import { Inject, Injectable } from "@nestjs/common";

import { CACHE, type CachePort } from "../../infra/cache/cache.port";
import { NotFoundError } from "../../http/errors";
import {
  toDetail,
  toSummary,
  type TemplateDetailDto,
  type TemplateSummaryDto,
} from "./template.dto";
import { TemplateRepository, type CatalogFilters } from "./template.repository";

/**
 * P2-01 — the catalog.
 *
 * ## Cached, and the cache is never the source of truth
 *
 * `docs/ARCHITECTURE/06` § What Is Cached lists template definitions as Redis-cached,
 * "invalidated when an admin publishes a new version". Every read here is
 * cache-then-database, and every cache failure falls through — `CachePort` never throws,
 * so there is no path where an unreachable Redis makes the catalog unavailable.
 *
 * ## Why a namespace and not a TTL alone
 *
 * The TTL is a safety net, not the invalidation mechanism. `invalidate()` bumps a
 * generation counter that every key in the namespace is built from, so a publish makes
 * the whole namespace unreachable in one atomic round trip. `P5`'s admin publish endpoint
 * calls it; until that exists this is the seam, and it is tested directly rather than
 * described.
 */

/** The namespace every catalog key lives under. One bump clears all of it. */
export const TEMPLATE_CACHE_NAMESPACE = "tpl";

/**
 * An hour.
 *
 * Long, because the underlying data changes a few times a year and the generation
 * counter — not this number — is what makes a publish visible. It exists for the case
 * where an invalidation is lost entirely: `docs/ARCHITECTURE/06` § Invalidation Strategy
 * asks for "an absolute TTL as a safety net if event invalidation fails to be delivered",
 * and an hour is the figure that document uses for the public page.
 */
const TTL_SECONDS = 3600;

export interface CatalogQuery {
  readonly category?: string | undefined;
  readonly search?: string | undefined;
  readonly isPremium?: boolean | undefined;
  readonly limit: number;
  readonly offset: number;
}

@Injectable()
export class TemplateService {
  constructor(
    private readonly repository: TemplateRepository,
    @Inject(CACHE) private readonly cache: CachePort,
  ) {}

  async list(
    query: CatalogQuery,
  ): Promise<{ items: TemplateSummaryDto[]; total: number }> {
    const key = listKey(query);
    const cached = await this.cache.getJson<{
      items: TemplateSummaryDto[];
      total: number;
    }>(TEMPLATE_CACHE_NAMESPACE, key);
    if (cached !== undefined) return cached;

    const { items, total } = await this.repository.findPublishedPage(
      query as CatalogFilters,
    );
    const result = {
      items: items.map((row) => toSummary(row.template, row.sections)),
      total,
    };

    await this.cache.setJson(
      TEMPLATE_CACHE_NAMESPACE,
      key,
      result,
      TTL_SECONDS,
    );
    return result;
  }

  /**
   * A template and its newest published version.
   *
   * 404 when the template does not exist, is not published, or has no published version.
   * One answer for three states on purpose: a draft template is not a thing the catalog
   * should confirm the existence of, and distinguishing "exists but unreleased" from
   * "does not exist" leaks the release schedule.
   */
  async detail(slug: string): Promise<TemplateDetailDto> {
    const key = `detail:${slug}`;
    const cached = await this.cache.getJson<TemplateDetailDto>(
      TEMPLATE_CACHE_NAMESPACE,
      key,
    );
    if (cached !== undefined) return cached;

    const found = await this.repository.findPublishedBySlug(slug);
    if (found === null) throw new NotFoundError();

    const result = toDetail(found.template, found.version);
    await this.cache.setJson(
      TEMPLATE_CACHE_NAMESPACE,
      key,
      result,
      TTL_SECONDS,
    );
    return result;
  }

  /**
   * One named version, which may be deprecated. Card step 3.
   *
   * BR-3.3's two questions, answered separately: this one is "render the version I am
   * naming", which a demo link and an invitation already locked to an old version both
   * need. `list` and `detail` answer "what may a new invitation choose", and deprecated
   * versions are absent from both.
   */
  async version(slug: string, version: string): Promise<TemplateDetailDto> {
    const key = `version:${slug}:${version}`;
    const cached = await this.cache.getJson<TemplateDetailDto>(
      TEMPLATE_CACHE_NAMESPACE,
      key,
    );
    if (cached !== undefined) return cached;

    const found = await this.repository.findVersion(slug, version);
    if (found === null) throw new NotFoundError();

    const result = toDetail(found.template, found.version);
    await this.cache.setJson(
      TEMPLATE_CACHE_NAMESPACE,
      key,
      result,
      TTL_SECONDS,
    );
    return result;
  }

  /**
   * Drop every cached catalog answer.
   *
   * Called by the admin publish and deprecate endpoints, which are `P5-02`'s. It lives
   * here rather than there because the namespace is this module's, and a caller that had
   * to know the key layout would be a second place to get it wrong.
   */
  async invalidate(): Promise<number> {
    return this.cache.invalidateNamespace(TEMPLATE_CACHE_NAMESPACE);
  }
}

/**
 * A stable key for a filter combination.
 *
 * Fixed order, so `?search=a&category=b` and `?category=b&search=a` are one cache entry
 * rather than two.
 *
 * `JSON.stringify` rather than joining on a separator, because the search term is user
 * input and any separator can appear inside it. Joined on a space,
 * `category="" search="a b"` and `category="a" search="b"` differ by one space that is
 * easy to lose -- and a cache key collision serves one filtered catalog in answer to a
 * different filter, which is a correctness bug that presents as a caching mystery.
 */
function listKey(query: CatalogQuery): string {
  return `list:${JSON.stringify([
    query.category ?? null,
    query.search ?? null,
    query.isPremium ?? null,
    query.limit,
    query.offset,
  ])}`;
}
