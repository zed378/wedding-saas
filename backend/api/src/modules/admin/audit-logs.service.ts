import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { redact } from "@wi/logging";

import { DB, type Database } from "../../infra/db/client";
import { auditLogs, users } from "../../infra/db/schema/index";
import type { AuditLogQueryDto } from "./schemas/admin-action.schema";
import type { Transaction } from "../../shared/db/transaction";
import { AuditLogService } from "../../shared/audit/audit-log.service";
import { ValidationError } from "../../http/errors";

export interface AuditLogItem {
  readonly id: string;
  readonly admin_id: string;
  readonly admin_email: string | null;
  readonly action: string;
  readonly resource_type: string;
  readonly resource_id: string;
  readonly reason: string | null;
  readonly before_state: Record<string, unknown> | null;
  readonly after_state: Record<string, unknown> | null;
  readonly ip_address: string | null;
  readonly created_at: string;
}

export interface PaginatedAuditLogs {
  readonly items: readonly AuditLogItem[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly total_pages: number;
}

@Injectable()
export class AdminAuditLogService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditLogService,
  ) {}

  async export(adminId: string, query: AuditLogQueryDto) {
    return this.db.transaction(
      async (tx) => {
        const result = await this.read(
          { ...query, page: 1, limit: 10_000 },
          tx,
        );
        if (result.total > 10_000) {
          throw new ValidationError([
            {
              field: "query",
              message:
                "Export is limited to 10000 rows. Narrow the date range or resource filters.",
            },
          ]);
        }
        const exportId = randomUUID();
        const { page: _page, limit: _limit, ...filters } = query;
        await this.audit.record(tx, {
          adminId,
          action: "audit_log.export",
          resourceType: "audit_log_export",
          resourceId: exportId,
          reason: "Incident investigation audit export",
          afterState: { filters, row_count: result.items.length },
        });
        return {
          export_id: exportId,
          exported_at: new Date().toISOString(),
          items: result.items,
          total: result.total,
        };
      },
      { isolationLevel: "repeatable read" },
    );
  }

  async list(query: AuditLogQueryDto): Promise<PaginatedAuditLogs> {
    return this.read(query, this.db);
  }

  private async read(
    query: AuditLogQueryDto,
    db: Database | Transaction,
  ): Promise<PaginatedAuditLogs> {
    const conditions = [];

    if (query.admin_id) {
      conditions.push(eq(auditLogs.adminId, query.admin_id));
    }

    if (query.resource_type) {
      conditions.push(eq(auditLogs.resourceType, query.resource_type));
    }

    if (query.resource_id) {
      conditions.push(eq(auditLogs.resourceId, query.resource_id));
    }

    if (query.date_from) {
      conditions.push(gte(auditLogs.createdAt, new Date(query.date_from)));
    }

    if (query.date_to) {
      conditions.push(lte(auditLogs.createdAt, new Date(query.date_to)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Total count
    const [countResult] = await db
      .select({ total: count() })
      .from(auditLogs)
      .where(whereClause);

    const total = Number(countResult?.total ?? 0);
    const offset = (query.page - 1) * query.limit;

    // Paginated query joined with admin user details
    const rows = await db
      .select({
        id: auditLogs.id,
        adminId: auditLogs.adminId,
        adminEmail: users.email,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        reason: auditLogs.reason,
        beforeState: auditLogs.beforeState,
        afterState: auditLogs.afterState,
        ipAddress: auditLogs.ipAddress,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.adminId, users.id))
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(query.limit)
      .offset(offset);

    const items: AuditLogItem[] = rows.map((r) => ({
      id: r.id,
      admin_id: r.adminId,
      admin_email: r.adminEmail,
      action: r.action,
      resource_type: r.resourceType,
      resource_id: r.resourceId,
      reason: r.reason,
      before_state: r.beforeState
        ? (redact(r.beforeState) as Record<string, unknown>)
        : null,
      after_state: r.afterState
        ? (redact(r.afterState) as Record<string, unknown>)
        : null,
      ip_address: r.ipAddress,
      created_at: r.createdAt.toISOString(),
    }));

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      total_pages: Math.ceil(total / query.limit) || 1,
    };
  }
}
