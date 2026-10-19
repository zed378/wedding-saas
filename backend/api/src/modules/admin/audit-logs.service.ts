import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { auditLogs, users } from "../../infra/db/schema/index";
import type { AuditLogQueryDto } from "./schemas/admin-action.schema";

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
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(query: AuditLogQueryDto): Promise<PaginatedAuditLogs> {
    const conditions = [];

    if (query.admin_id) {
      conditions.push(eq(auditLogs.adminId, query.admin_id));
    }

    if (query.resource_type) {
      conditions.push(eq(auditLogs.resourceType, query.resource_type));
    }

    if (query.date_from) {
      conditions.push(gte(auditLogs.createdAt, new Date(query.date_from)));
    }

    if (query.date_to) {
      conditions.push(lte(auditLogs.createdAt, new Date(query.date_to)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Total count
    const [countResult] = await this.db
      .select({ total: count() })
      .from(auditLogs)
      .where(whereClause);

    const total = Number(countResult?.total ?? 0);
    const offset = (query.page - 1) * query.limit;

    // Paginated query joined with admin user details
    const rows = await this.db
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
      .orderBy(desc(auditLogs.createdAt))
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
      before_state: (r.beforeState as Record<string, unknown>) ?? null,
      after_state: (r.afterState as Record<string, unknown>) ?? null,
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
