import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, isNull, sql } from "drizzle-orm";
import { DB, type Database } from "../../infra/db/client";
import { invitations } from "../../infra/db/schema/invitations";
import { slugBlocklist } from "../../infra/db/schema/templates";
import { auditLogs } from "../../infra/db/schema/index";
import { AuditLogService } from "../../shared/audit/audit-log.service";
import type { Transaction } from "../../shared/db/transaction";

@Injectable()
export class AdminSlugBlocklistRepository {
  constructor(
    @Inject(DB) readonly db: Database,
    private readonly audit: AuditLogService,
  ) {}

  async list(page: number, perPage: number) {
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(slugBlocklist)
        .orderBy(asc(slugBlocklist.term), asc(slugBlocklist.id))
        .limit(perPage)
        .offset((page - 1) * perPage),
      this.db.select({ total: count() }).from(slugBlocklist),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  // SECURITY/05: this tenant bypass exposes only operational fields and records
  // each returned invitation in the same transaction as its read.
  async adminFindMatches(
    tx: Transaction,
    adminId: string,
    term: string,
    matchType: string,
    reason: string,
  ) {
    const predicate = and(
      isNull(invitations.deletedAt),
      matchType === "exact"
        ? sql`lower(${invitations.slug}) = ${term}`
        : sql`strpos(translate(lower(${invitations.slug}), '431057@$', 'aeiostas'), ${term}) > 0`,
    );
    const rows = await tx
      .select({
        id: invitations.id,
        slug: invitations.slug,
        status: invitations.status,
      })
      .from(invitations)
      .where(predicate)
      .orderBy(asc(invitations.id))
      .limit(100);
    const [totals] = await tx
      .select({ total: count() })
      .from(invitations)
      .where(predicate);
    if (rows.length)
      await tx.insert(auditLogs).values(
        rows.map((row) => ({
          adminId,
          action: "admin.read",
          resourceType: "invitation",
          resourceId: row.id,
          reason,
        })),
      );
    return { existing_matches: rows, existing_match_count: totals?.total ?? 0 };
  }

  async record(
    tx: Transaction,
    adminId: string,
    id: string,
    action: string,
    reason: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ) {
    await this.audit.record(tx, {
      adminId,
      resourceType: "slug_blocklist",
      resourceId: id,
      action,
      reason,
      ...(before ? { beforeState: before } : {}),
      ...(after ? { afterState: after } : {}),
    });
  }
}
