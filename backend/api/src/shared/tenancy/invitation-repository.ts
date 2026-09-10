import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, desc, inArray, sql } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import {
  invitations,
  invitationPeople,
  invitationEvents,
  invitationGallery,
  invitationBankAccounts,
  invitationGuests,
  invitationGuestbook,
  invitationPreviewTokens,
  invitationStatusHistory,
  auditLogs,
} from "../../infra/db/schema/index";
import type { AdminBypass, TenantScope } from "./tenant-scope";

/**
 * Tenant-scoped data access for invitations and their children.
 *
 * `docs/SECURITY/05` is the project's number one security priority, with zero tolerance
 * for regressions. The design goal of this file is narrow and worth stating plainly:
 *
 *   **there is no exported way to fetch an invitation, or any child of one, without
 *   either a TenantScope or a name containing the word `admin`.**
 *
 * Not "discouraged". Not "caught in review". Absent from the surface. Every `:id`
 * endpoint in Phases 1 to 5 is built on this, and the alternative to getting it right
 * here is auditing all of them later.
 *
 * Three rules this layer keeps, each of them a documented attack surface:
 *
 *   1. The owner filter is a QUERY PREDICATE, never a check after the fetch
 *      (`docs/SECURITY/04` § 3). "Not found" and "not yours" are the same `null`, so a
 *      service physically cannot return a 403 that confirms a resource exists
 *      (ADR-018, `docs/SECURITY/05` § 4).
 *   2. A child is validated against its parent AND the parent against its owner, in ONE
 *      query (`docs/SECURITY/05` § 6 and § 7). Two round trips invite skipping the
 *      second.
 *   3. The admin bypass writes its own audit row, in the same transaction as the read
 *      (`docs/SECURITY/05` § Special Case). A caller cannot obtain the data and forget
 *      the trail, because obtaining it is what writes the trail.
 */

/**
 * The child tables reachable through `findOwnedChild`, as an explicit union.
 *
 * An allowlist rather than a structural `PgTable` constraint, and that is a security
 * property as much as a typing convenience: a structural type would also accept `users`
 * or `orders` if they happened to have the right column names, and "which tables can be
 * addressed as a child of an invitation" is exactly the sort of question that should
 * have one written answer.
 *
 * Only tables with their own `id` appear here. `invitation_settings`, `invitation_quote`
 * and `invitation_custom_domains` are keyed by `invitation_id` and have no child id to
 * address; `invitation_view_counts` has a composite key. Those are reached with
 * `findOwnedChildren` or a dedicated method.
 */
export type InvitationChildTable =
  | typeof invitationPeople
  | typeof invitationEvents
  | typeof invitationGallery
  | typeof invitationBankAccounts
  | typeof invitationGuests
  | typeof invitationGuestbook
  | typeof invitationPreviewTokens
  | typeof invitationStatusHistory;

export interface OwnedListFilters {
  readonly status?: string | readonly string[];
  readonly limit?: number;
  readonly offset?: number;
}

type InvitationRow = typeof invitations.$inferSelect;

@Injectable()
export class InvitationRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * The invitation, if this scope owns it. `null` otherwise — whether it belongs to
   * someone else, was soft-deleted, or never existed.
   *
   * The caller cannot tell those apart, and that is the feature. `docs/SECURITY/04`
   * § Example Pseudocode requires a 404 for "exists but isn't yours"; the cleanest way
   * to guarantee that is to make the difference unavailable above this line.
   */
  async findOwned(
    invitationId: string,
    scope: TenantScope,
  ): Promise<InvitationRow | null> {
    const [row] = await this.db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.ownerId, scope),
          // A soft-deleted invitation is gone as far as its owner is concerned, and
          // ADR-033 lets its slug be taken by a live one. Returning it would let a
          // deleted invitation shadow the invitation that replaced it.
          isNull(invitations.deletedAt),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /**
   * Whether this scope owns the invitation. Same query, no row shipped.
   *
   * For write paths that need the ownership proof but not the data — `docs/SECURITY/04`
   * § 2 puts the check in the service, and a service that fetches a whole row only to
   * discard it invites someone to "optimise" the check away.
   */
  async ownsInvitation(
    invitationId: string,
    scope: TenantScope,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(invitations)
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.ownerId, scope),
          isNull(invitations.deletedAt),
        ),
      )
      .limit(1);

    return row !== undefined;
  }

  /**
   * This scope's invitations. The owner filter is in the SQL.
   *
   * `docs/SECURITY/05` § 5 names filtering in the response as the wrong answer, by
   * name, as an attack surface. Loading everything and filtering in JavaScript works
   * perfectly until a `.filter()` is dropped in a refactor, and then it leaks every
   * tenant at once through an endpoint that still looks correct.
   */
  async findOwnedList(
    scope: TenantScope,
    filters: OwnedListFilters = {},
  ): Promise<InvitationRow[]> {
    const conditions = [
      eq(invitations.ownerId, scope),
      isNull(invitations.deletedAt),
    ];

    if (filters.status !== undefined) {
      const statuses =
        typeof filters.status === "string"
          ? [filters.status]
          : [...filters.status];
      // An empty status filter must match nothing, not everything. `inArray` with an
      // empty list is the classic way a filter silently turns into "no filter".
      if (statuses.length === 0) return [];
      conditions.push(inArray(invitations.status, statuses));
    }

    return this.db
      .select()
      .from(invitations)
      .where(and(...conditions))
      .orderBy(desc(invitations.createdAt))
      .limit(Math.min(filters.limit ?? 50, 100))
      .offset(filters.offset ?? 0);
  }

  /**
   * A child row, but only if it belongs to `invitationId` AND that invitation belongs
   * to `scope`.
   *
   * This closes `docs/SECURITY/05` § 6 and § 7 — the sub-resource holes. The document
   * asks for two validations: `child.invitation_id === :id` and
   * `invitation.owner_id === current_user.id`. Both are in the one statement below, so
   * there is no intermediate state in which someone has done the first and moved on.
   *
   * The concrete attack: `PATCH /invitations/{mine}/bank-accounts/{someone-elses}`.
   * The parent is genuinely mine, the child id is genuinely valid, and a naive
   * implementation that checks the parent and then loads the child by id alone hands
   * over — or overwrites — another couple's bank account.
   */
  async findOwnedChild<T extends InvitationChildTable>(
    table: T,
    childId: string,
    invitationId: string,
    scope: TenantScope,
  ): Promise<T["$inferSelect"] | null> {
    const [row] = await this.db
      .select({ child: table as InvitationChildTable })
      .from(table as InvitationChildTable)
      .innerJoin(invitations, eq(table.invitationId, invitations.id))
      .where(
        and(
          eq(table.id, childId),
          eq(table.invitationId, invitationId),
          eq(invitations.ownerId, scope),
          isNull(invitations.deletedAt),
        ),
      )
      .limit(1);

    return (row?.child as T["$inferSelect"] | undefined) ?? null;
  }

  /** Every child of an owned invitation. Same two conditions, list form. */
  async findOwnedChildren<T extends InvitationChildTable>(
    table: T,
    invitationId: string,
    scope: TenantScope,
  ): Promise<T["$inferSelect"][]> {
    const rows = await this.db
      .select({ child: table as InvitationChildTable })
      .from(table as InvitationChildTable)
      .innerJoin(invitations, eq(table.invitationId, invitations.id))
      .where(
        and(
          eq(table.invitationId, invitationId),
          eq(invitations.ownerId, scope),
          isNull(invitations.deletedAt),
        ),
      );

    return rows.map((r) => r.child as T["$inferSelect"]);
  }

  /**
   * ADMIN SUPPORT PATH — deliberately bypasses tenant isolation.
   *
   * The name is long and unpleasant on purpose. `docs/SECURITY/04` § 4 asks for the
   * bypass to be "clear in the code", and a reviewer scanning a diff should not have to
   * think about whether this line is the safe one.
   *
   * The audit row is written HERE, inside the same transaction as the read, rather than
   * being left to the caller. `docs/SECURITY/05` § Special Case requires every use to
   * be logged; making that the caller's job means the first time someone forgets, a
   * tenant-isolation bypass happens with no record at all. Writing it here means there
   * is no way to get the data without leaving the trail.
   *
   * It fails CLOSED: if the audit insert fails, the transaction rolls back and the
   * caller gets an error instead of the invitation. `docs/SECURITY/00` requires failing
   * closed on anything security-relevant, and an unauditable bypass qualifies.
   *
   * Soft-deleted rows ARE returned here — support frequently needs to look at exactly
   * the invitation a user says has disappeared.
   */
  async adminFindInvitationBypassingOwnership(
    invitationId: string,
    bypass: AdminBypass,
  ): Promise<InvitationRow | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.id, invitationId))
        .limit(1);

      await tx.insert(auditLogs).values({
        adminId: bypass.adminId,
        action: "invitation.admin_read",
        resourceType: "invitation",
        resourceId: invitationId,
        reason: bypass.reason,
        // Recorded even when nothing was found: an admin probing ids that do not exist
        // is itself worth seeing in the trail.
        afterState: { found: row !== undefined },
      });

      return row ?? null;
    });
  }
}
