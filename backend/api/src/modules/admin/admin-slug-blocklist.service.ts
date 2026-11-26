import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { CACHE, type CachePort } from "../../infra/cache/cache.port";
import { slugBlocklist } from "../../infra/db/schema/templates";
import { ConflictError, NotFoundError } from "../../http/errors";
import {
  checkSlugFormat,
  foldLeet,
  SlugService,
} from "../invitation/slug.service";
import { AdminSlugBlocklistRepository } from "./admin-slug-blocklist.repository";
import type { SlugBlocklistWrite } from "./schemas/admin-slug-blocklist.schema";

type Row = typeof slugBlocklist.$inferSelect;
export function blocklistDto(row: Row) {
  return {
    id: row.id,
    term: row.term,
    match_type: row.matchType,
    category: row.category,
    reason: row.reason,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
  };
}

// These are the non-invitation prefixes served on this host, including Next assets.
export const PROTECTED_PUBLIC_TERMS = ["preview", "public"] as const;

@Injectable()
export class AdminSlugBlocklistService {
  constructor(
    private readonly repository: AdminSlugBlocklistRepository,
    @Inject(CACHE) private readonly cache: CachePort,
    private readonly slugs: SlugService,
  ) {}

  async list(page: number, perPage: number) {
    const { rows, total } = await this.repository.list(page, perPage);
    return {
      data: rows.map(blocklistDto),
      meta: { page, per_page: perPage, total },
    };
  }

  async test(slug: string) {
    const format = checkSlugFormat(slug);
    if (format)
      return {
        blocked: false,
        valid_format: false,
        message: format.message,
        matching_term: null,
      };
    const matching = await this.slugs.findBlockingTerm(slug);
    return {
      blocked: matching !== undefined,
      valid_format: true,
      matching_term: matching ?? null,
    };
  }

  async save(adminId: string, data: SlugBlocklistWrite, id?: string) {
    try {
      const result = await this.repository.db.transaction(async (tx) => {
        const [before] = id
          ? await tx
              .select()
              .from(slugBlocklist)
              .where(eq(slugBlocklist.id, id))
              .for("update")
          : [];
        if (id && !before) throw new NotFoundError();
        if (before) this.protect(before, data);
        const values = {
          term: data.term,
          matchType: data.match_type,
          category: data.category,
          reason: data.reason,
        };
        const [row] = id
          ? await tx
              .update(slugBlocklist)
              .set(values)
              .where(eq(slugBlocklist.id, id))
              .returning()
          : await tx
              .insert(slugBlocklist)
              .values({ ...values, createdBy: adminId })
              .returning();
        if (!row) throw new NotFoundError();
        await this.repository.record(
          tx,
          adminId,
          row.id,
          id ? "slug_blocklist.update" : "slug_blocklist.create",
          data.reason,
          before ? blocklistDto(before) : undefined,
          blocklistDto(row),
        );
        const matches = await this.repository.adminFindMatches(
          tx,
          adminId,
          data.match_type === "substring" ? foldLeet(data.term) : data.term,
          data.match_type,
          "Inspect existing slugs after blocklist update",
        );
        return { entry: blocklistDto(row), ...matches };
      });
      await this.cache.invalidateNamespace("slug-blocklist");
      return result;
    } catch (error) {
      const pg = error as { code?: string; cause?: { code?: string } };
      if ((pg.code ?? pg.cause?.code) === "23505")
        throw new ConflictError(
          "BLOCKLIST_TERM_EXISTS",
          "Term and match type already exist.",
        );
      throw error;
    }
  }

  async remove(adminId: string, id: string, reason: string) {
    await this.repository.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(slugBlocklist)
        .where(eq(slugBlocklist.id, id))
        .for("update");
      if (!before) throw new NotFoundError();
      this.protect(before);
      await tx.delete(slugBlocklist).where(eq(slugBlocklist.id, id));
      await this.repository.record(
        tx,
        adminId,
        id,
        "slug_blocklist.delete",
        reason,
        blocklistDto(before),
      );
    });
    await this.cache.invalidateNamespace("slug-blocklist");
    return { id };
  }

  private protect(before: Row, after?: SlugBlocklistWrite) {
    const seededReservation =
      before.createdBy === null && before.category === "reserved";
    const publicReservation = PROTECTED_PUBLIC_TERMS.some(
      (term) => term === before.term,
    );
    if (
      (seededReservation || publicReservation) &&
      before.matchType === "exact" &&
      (!after ||
        after.term !== before.term ||
        after.match_type !== "exact" ||
        (seededReservation && after.category !== "reserved"))
    ) {
      throw new ConflictError(
        "RESERVED_PUBLIC_ROUTE",
        "This term protects a public route and must remain reserved.",
      );
    }
  }
}
