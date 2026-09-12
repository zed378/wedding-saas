import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { pageMeta, parsePagination } from "../../http/pagination";
import { rateLimit } from "../../shared/rate-limit/rate-limit.guard";
import { TemplateService } from "./template.service";

/**
 * P2-01 — the template catalog. `docs/API/03`.
 *
 * ## Anonymous, on the authenticated prefix
 *
 * `docs/API/03` heads these three routes "Public/Authenticated (read catalog)" and gives
 * them the `/api/v1` path, and `docs/UI-UX/11` § "Use This Template" settles what that
 * means in practice: "If not logged in: save the template choice … redirect to
 * login/register". A visitor browses the catalog **before** they have an account.
 *
 * So there is no `requireAuth()` here, and that is a deliberate exception to the note on
 * `SURFACE.AUTHENTICATED` rather than an omission — recorded as ADR-059. Everything the
 * catalog serves is marketing material: names, categories, thumbnails and the section
 * structure of a template anyone can see rendered on the demo page.
 *
 * Rate limited on `general-public`, keyed by IP hash, because without a session there is
 * no user to key on.
 *
 * ## No `:id` endpoint here, and that is not an oversight
 *
 * Every route addresses a template by **slug**, which is a public identifier by design.
 * There is no ownership to check: a template belongs to the platform, not to a tenant.
 * `docs/SECURITY/05`'s object-level rule is about tenant-owned resources and does not
 * apply — which is worth stating, because a reviewer who greps for `requireOwnership` in
 * this file and finds nothing should be able to stop here rather than wonder.
 */

/**
 * `docs/API/03`: `?category=&search=&is_premium=&page=`.
 *
 * `.strict()` is deliberate even on a query string. An unknown filter that is silently
 * ignored means a client asking for `?is_premium=true&category=x` with a typo gets the
 * unfiltered catalog and no indication anything was wrong.
 */
const catalogQuerySchema = z
  .object({
    category: z.string().trim().min(1).max(40).optional(),
    search: z.string().trim().min(1).max(80).optional(),
    // A query string carries text; `"true"`/`"false"` are what a browser sends.
    is_premium: z.enum(["true", "false"]).optional(),
    page: z.string().optional(),
    per_page: z.string().optional(),
  })
  .strict();

/**
 * A semver-shaped version number, matching the column's own constraint.
 *
 * Bounded rather than free text because it reaches a cache key. An unbounded path
 * parameter behind a cache is a way to fill Redis with one request per distinct string.
 */
const versionParamSchema = z
  .string()
  .regex(/^\d{1,5}\.\d{1,5}\.\d{1,5}$/, "Gunakan format versi seperti 1.2.0.");

const slugParamSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/, "Alamat template tidak valid.");

@Controller("api/v1/templates")
@UseGuards(rateLimit("general-public"))
export class TemplateController {
  constructor(private readonly templates: TemplateService) {}

  /** `GET /templates` — the catalog, filtered and paginated. */
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    const parsed = parse(catalogQuerySchema, query);
    const pagination = parsePagination({
      ...(parsed.page !== undefined ? { page: parsed.page } : {}),
      ...(parsed.per_page !== undefined ? { per_page: parsed.per_page } : {}),
    });

    const { items, total } = await this.templates.list({
      ...(parsed.category !== undefined ? { category: parsed.category } : {}),
      ...(parsed.search !== undefined ? { search: parsed.search } : {}),
      ...(parsed.is_premium !== undefined
        ? { isPremium: parsed.is_premium === "true" }
        : {}),
      limit: pagination.limit,
      offset: pagination.offset,
    });

    return ok(items, pageMeta(pagination, total));
  }

  /**
   * `GET /templates/:slug` — the detail, with the newest published version.
   *
   * Declared before nothing in particular: there is no parameterised sibling that could
   * swallow a literal path here. `P1-21`'s lesson about Nest's declaration-order matching
   * applies to a literal route under a parameterised one, which this module has none of.
   */
  @Get(":slug")
  async detail(@Param("slug") slug: string) {
    return ok(await this.templates.detail(parse(slugParamSchema, slug)));
  }

  /** `GET /templates/:slug/versions/:version` — one named version, demo and preview. */
  @Get(":slug/versions/:version")
  async version(
    @Param("slug") slug: string,
    @Param("version") version: string,
  ) {
    return ok(
      await this.templates.version(
        parse(slugParamSchema, slug),
        parse(versionParamSchema, version),
      ),
    );
  }
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  throw new ValidationError(
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "query",
      message: issue.message,
    })),
  );
}
