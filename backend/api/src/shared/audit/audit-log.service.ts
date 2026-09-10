import { Injectable } from "@nestjs/common";

import { auditLogs } from "../../infra/db/schema/index";
import { redact } from "@wi/logging";
import type { Transaction } from "../db/transaction";

/**
 * The admin audit trail. `docs/DATABASE/10-AUDIT-LOGS.md`.
 *
 * Two properties this service exists to make structural rather than remembered:
 *
 *   1. **The row is written inside the caller's transaction.** `record()` takes a `tx`
 *      handle and has no way to open its own. An audit row that commits when the action
 *      it describes rolled back is not a record, it is a false one -- and it is the kind
 *      of false record nobody notices, because it looks exactly like a true one.
 *
 *   2. **Snapshots are trimmed before storage.** `docs/DATABASE/10` § Policy: store only
 *      the relevant fields, "avoid unnecessarily duplicating bank account data". The
 *      trimming reuses P0-12's redactor rather than a second list -- a value that must
 *      not sit in a 90-day log certainly must not sit in a table with **2-year**
 *      retention, and two lists would drift apart within a phase.
 *
 * The table is append-only at the permission level: `P0-10` revoked UPDATE and DELETE
 * from the application role. This service can only ever insert, whatever it tries.
 */

export interface AuditEntry {
  /** The acting admin. Not nullable -- an admin action has an admin. */
  readonly adminId: string;
  /** Dotted, e.g. `user.suspend`, `order.refund`. `docs/DATABASE/10`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Why. Required for anything an incident reviewer might question. */
  readonly reason?: string;
  readonly beforeState?: Record<string, unknown>;
  readonly afterState?: Record<string, unknown>;
  readonly ipAddress?: string;
}

@Injectable()
export class AuditLogService {
  /**
   * Write one audit row inside `tx`.
   *
   * Requiring the transaction rather than opening one is the whole design. A caller
   * cannot record an action and then have that action fail: either both commit or
   * neither does.
   */
  async record(tx: Transaction, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLogs).values({
      adminId: entry.adminId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      ...(entry.beforeState !== undefined
        ? { beforeState: trim(entry.beforeState) }
        : {}),
      ...(entry.afterState !== undefined
        ? { afterState: trim(entry.afterState) }
        : {}),
      ...(entry.ipAddress !== undefined ? { ipAddress: entry.ipAddress } : {}),
    });
  }
}

/**
 * Trim a state snapshot to something safe to keep for two years.
 *
 * `redact()` removes credentials and masks account numbers and emails by key name at any
 * depth. Passing the whole row through it is deliberate: the alternative is asking each
 * caller to pick the "relevant fields", which is a judgement made under time pressure by
 * someone who is thinking about the feature rather than about retention.
 */
function trim(state: Record<string, unknown>): Record<string, unknown> {
  return redact(state) as Record<string, unknown>;
}
