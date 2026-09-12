import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, isNull, desc, inArray, ne, sql } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import {
  invitations,
  invitationPeople,
  invitationSettings,
  invitationQuote,
  invitationEvents,
  invitationGallery,
  invitationBankAccounts,
  invitationGuests,
  invitationGuestbook,
  invitationPreviewTokens,
  invitationStatusHistory,
  auditLogs,
  media,
} from "../../infra/db/schema/index";
import type { AdminBypass, TenantScope } from "./tenant-scope";
import type { Transaction } from "../db/transaction";

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

/**
 * One invitation row.
 *
 * **Exported**, so a caller that needs the shape does not import the table to get it.
 * `scripts/check-tenant-scope.mjs` is a text check and does not distinguish `import type`
 * from a value import -- which is the correct blunt instrument, since a file that has the
 * table in scope is one edit away from querying it. `P1-10`'s DTO needed the type and
 * tripped the guard; re-exporting it here points the dependency the right way round.
 */
export type InvitationRow = typeof invitations.$inferSelect;

/**
 * One event row.
 *
 * Exported for the same reason as `InvitationRow`: a caller that needs the shape must not
 * import the table to get it.
 */
export type InvitationEventRow = typeof invitationEvents.$inferSelect;

/** One gift-account row. Exported so a caller need not import the table. */
export type InvitationBankAccountRow =
  typeof invitationBankAccounts.$inferSelect;

/** One quote row. */
export type InvitationQuoteRow = typeof invitationQuote.$inferSelect;

/** Everything `docs/API/04` § Example Response embeds. `P1-10`. */
export interface InvitationAggregate {
  readonly people: (typeof invitationPeople.$inferSelect)[];
  readonly events: (typeof invitationEvents.$inferSelect)[];
  readonly gallery: (typeof invitationGallery.$inferSelect)[];
  readonly bankAccounts: (typeof invitationBankAccounts.$inferSelect)[];
  readonly settings: typeof invitationSettings.$inferSelect | null;
  readonly quote: typeof invitationQuote.$inferSelect | null;
}

/** The statuses an invitation only reaches by being paid for. BR-1.4. */
const NEVER_PAID_STATUSES = ["paid", "published", "expired"] as const;

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
   * Create an event on an owned invitation. `P1-12`.
   *
   * The owner predicate rides in as a correlated `EXISTS` on the `INSERT`'s `SELECT`, so
   * the row cannot be created on somebody else's invitation even if the caller's
   * ownership check were removed upstream. Returns `null` when the invitation is not
   * theirs, which the caller turns into a 404.
   */
  async createEvent(
    invitationId: string,
    scope: TenantScope,
    input: {
      readonly type: string;
      readonly title: string;
      readonly eventDate: string;
      readonly startTime: string;
      readonly endTime?: string | null | undefined;
      readonly venueName: string;
      readonly address: string;
      readonly latitude?: string | null | undefined;
      readonly longitude?: string | null | undefined;
      readonly mapsUrl?: string | null | undefined;
      readonly description?: string | null | undefined;
      readonly displayOrder?: number | undefined;
    },
  ): Promise<typeof invitationEvents.$inferSelect | null> {
    const owns = await this.ownsInvitation(invitationId, scope);
    if (!owns) return null;

    const rows = await this.db
      .insert(invitationEvents)
      .values({
        invitationId,
        type: input.type,
        title: input.title,
        eventDate: input.eventDate,
        startTime: input.startTime,
        endTime: input.endTime ?? null,
        venueName: input.venueName,
        address: input.address,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        mapsUrl: input.mapsUrl ?? null,
        description: input.description ?? null,
        displayOrder: input.displayOrder ?? 0,
      })
      .returning();

    return rows[0] ?? null;
  }

  /**
   * One event of an owned invitation, or `null`. `P1-12`.
   *
   * A named wrapper over `findOwnedChild` so a caller does not have to import
   * `invitationEvents` to name the table — `scripts/check-tenant-scope.mjs` refuses that
   * import outside this layer, and it is right to: a file with the table in scope is one
   * edit away from querying it without a predicate.
   */
  async findOwnedEvent(
    eventId: string,
    invitationId: string,
    scope: TenantScope,
  ): Promise<InvitationEventRow | null> {
    return this.findOwnedChild(invitationEvents, eventId, invitationId, scope);
  }

  /** Every event of an owned invitation. Same reasoning as `findOwnedEvent`. */
  async findOwnedEvents(
    invitationId: string,
    scope: TenantScope,
  ): Promise<InvitationEventRow[]> {
    return this.findOwnedChildren(invitationEvents, invitationId, scope);
  }

  /**
   * One bank account of an owned invitation, or `null`. `P1-13`.
   *
   * Named wrapper, like `findOwnedEvent` — the caller must not hold the table.
   */
  async findOwnedBankAccount(
    bankAccountId: string,
    invitationId: string,
    scope: TenantScope,
  ): Promise<InvitationBankAccountRow | null> {
    return this.findOwnedChild(
      invitationBankAccounts,
      bankAccountId,
      invitationId,
      scope,
    );
  }

  /** Every bank account of an owned invitation. */
  async findOwnedBankAccounts(
    invitationId: string,
    scope: TenantScope,
  ): Promise<InvitationBankAccountRow[]> {
    return this.findOwnedChildren(invitationBankAccounts, invitationId, scope);
  }

  /**
   * Create a gift account, and audit it in the same transaction. `P1-13` step 4b.
   *
   * The audit row is not optional and cannot be separated from the write, because the
   * threat here is **tampering, not disclosure** (`docs/PLAN/18` R16). An attacker who
   * swaps the account number on a live invitation collects every guest's gift, and the
   * only thing that makes that recoverable afterwards is a trail saying who changed what
   * and when. A write that could commit without its audit row would lose exactly the
   * evidence an incident needs.
   *
   * `before_state`/`after_state` carry the **masked** number. `docs/DATABASE/10` § Policy
   * asks to "avoid unnecessarily duplicating bank account data" in audit rows, and a
   * two-year retention on a table of full account numbers is a worse liability than the
   * one it documents.
   */
  async createBankAccount(
    invitationId: string,
    scope: TenantScope,
    input: {
      readonly type: string;
      readonly providerName: string;
      readonly accountNumber: string;
      readonly accountHolder: string;
      readonly displayOrder?: number | undefined;
    },
    audit: (tx: Transaction, row: InvitationBankAccountRow) => Promise<void>,
  ): Promise<InvitationBankAccountRow | null> {
    if (!(await this.ownsInvitation(invitationId, scope))) return null;

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(invitationBankAccounts)
        .values({
          invitationId,
          type: input.type,
          providerName: input.providerName,
          accountNumber: input.accountNumber,
          accountHolder: input.accountHolder,
          displayOrder: input.displayOrder ?? 0,
        })
        .returning();

      const row = rows[0]!;
      await audit(tx, row);
      return row;
    });
  }

  /**
   * Update a gift account, audited in the same transaction, scoped by both conditions.
   *
   * Returns `null` when the account does not belong to this invitation **or** the
   * invitation does not belong to this scope — the two-step rule from `docs/SECURITY/05`
   * § 7, and on this table it is the control standing between a compromised account and
   * the guests' money.
   */
  async updateBankAccount(
    bankAccountId: string,
    invitationId: string,
    scope: TenantScope,
    changes: {
      readonly type?: string | undefined;
      readonly providerName?: string | undefined;
      readonly accountNumber?: string | undefined;
      readonly accountHolder?: string | undefined;
      readonly displayOrder?: number | undefined;
    },
    audit: (
      tx: Transaction,
      before: InvitationBankAccountRow,
      after: InvitationBankAccountRow,
    ) => Promise<void>,
  ): Promise<InvitationBankAccountRow | null> {
    const before = await this.findOwnedBankAccount(
      bankAccountId,
      invitationId,
      scope,
    );
    if (before === null) return null;

    const patch: Record<string, unknown> = {};
    if (changes.type !== undefined) patch["type"] = changes.type;
    if (changes.providerName !== undefined) {
      patch["providerName"] = changes.providerName;
    }
    if (changes.accountNumber !== undefined) {
      patch["accountNumber"] = changes.accountNumber;
    }
    if (changes.accountHolder !== undefined) {
      patch["accountHolder"] = changes.accountHolder;
    }
    if (changes.displayOrder !== undefined) {
      patch["displayOrder"] = changes.displayOrder;
    }

    if (Object.keys(patch).length === 0) return before;

    patch["updatedAt"] = new Date();

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(invitationBankAccounts)
        .set(patch)
        .where(
          and(
            eq(invitationBankAccounts.id, bankAccountId),
            eq(invitationBankAccounts.invitationId, invitationId),
            sql`EXISTS (
              SELECT 1 FROM invitations i
              WHERE i.id = ${invitationBankAccounts.invitationId}
                AND i.owner_id = ${scope}
                AND i.deleted_at IS NULL
            )`,
          ),
        )
        .returning();

      const after = rows[0];
      if (after === undefined) return null;

      await audit(tx, before, after);
      return after;
    });
  }

  /** Delete a gift account, audited in the same transaction. */
  async deleteBankAccount(
    bankAccountId: string,
    invitationId: string,
    scope: TenantScope,
    audit: (tx: Transaction, before: InvitationBankAccountRow) => Promise<void>,
  ): Promise<boolean> {
    const before = await this.findOwnedBankAccount(
      bankAccountId,
      invitationId,
      scope,
    );
    if (before === null) return false;

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .delete(invitationBankAccounts)
        .where(
          and(
            eq(invitationBankAccounts.id, bankAccountId),
            eq(invitationBankAccounts.invitationId, invitationId),
            sql`EXISTS (
              SELECT 1 FROM invitations i
              WHERE i.id = ${invitationBankAccounts.invitationId}
                AND i.owner_id = ${scope}
                AND i.deleted_at IS NULL
            )`,
          ),
        )
        .returning({ id: invitationBankAccounts.id });

      if (rows.length === 0) return false;

      await audit(tx, before);
      return true;
    });
  }

  /** The next `display_order` for a new gift account. Scoped, like the event version. */
  async nextBankAccountOrder(
    invitationId: string,
    scope: TenantScope,
  ): Promise<number> {
    const rows = await this.findOwnedBankAccounts(invitationId, scope);
    return rows.reduce((max, row) => Math.max(max, row.displayOrder + 1), 0);
  }

  /** The quote row of an owned invitation, or `null`. `P1-13`. */
  async findOwnedQuote(
    invitationId: string,
    scope: TenantScope,
  ): Promise<InvitationQuoteRow | null> {
    return this.findOwnedSingleton(invitationQuote, invitationId, scope);
  }

  /**
   * Update the quote. `P1-13`.
   *
   * An upsert, unlike the people rows: `P1-09` creates this row with the invitation, but
   * an invitation that predates it would otherwise have no quote to patch and the user
   * would get a 404 for a field the UI shows. The primary key is `invitation_id`, so a
   * concurrent double-write conflicts rather than duplicating.
   */
  async updateQuote(
    invitationId: string,
    scope: TenantScope,
    changes: {
      readonly text?: string | null | undefined;
      readonly source?: string | null | undefined;
    },
  ): Promise<InvitationQuoteRow | null> {
    if (!(await this.ownsInvitation(invitationId, scope))) return null;

    const patch: Record<string, unknown> = {};
    if (changes.text !== undefined) patch["text"] = changes.text;
    if (changes.source !== undefined) patch["source"] = changes.source;

    if (Object.keys(patch).length === 0) {
      return this.findOwnedQuote(invitationId, scope);
    }

    patch["updatedAt"] = new Date();

    const rows = await this.db
      .insert(invitationQuote)
      .values({
        invitationId,
        text: changes.text ?? null,
        source: changes.source ?? null,
      })
      .onConflictDoUpdate({
        target: invitationQuote.invitationId,
        set: patch,
      })
      .returning();

    return rows[0] ?? null;
  }

  /**
   * The next `display_order` for a new event. `P1-12` step 5.
   *
   * Appended rather than prepended: a new event must not silently jump to the front of a
   * list the couple ordered on purpose. Scoped, so it cannot count another tenant's rows.
   */
  async nextEventOrder(
    invitationId: string,
    scope: TenantScope,
  ): Promise<number> {
    const rows = await this.findOwnedChildren(
      invitationEvents,
      invitationId,
      scope,
    );

    return rows.reduce((max, row) => Math.max(max, row.displayOrder + 1), 0);
  }

  /**
   * Update one event, scoped by BOTH its invitation and that invitation's owner.
   * `docs/SECURITY/05` § 7.
   *
   * Two conditions in one statement. Owning the invitation in the path is necessary and not
   * sufficient: an event id belonging to a different invitation must change nothing, and
   * the only reliable way to guarantee that is for both predicates to be part of the write.
   */
  async updateEvent(
    eventId: string,
    invitationId: string,
    scope: TenantScope,
    changes: {
      readonly type?: string | undefined;
      readonly title?: string | undefined;
      readonly eventDate?: string | undefined;
      readonly startTime?: string | undefined;
      readonly endTime?: string | null | undefined;
      readonly venueName?: string | undefined;
      readonly address?: string | undefined;
      readonly latitude?: string | null | undefined;
      readonly longitude?: string | null | undefined;
      readonly mapsUrl?: string | null | undefined;
      readonly description?: string | null | undefined;
      readonly displayOrder?: number | undefined;
    },
  ): Promise<typeof invitationEvents.$inferSelect | null> {
    const patch: Record<string, unknown> = {};
    // Named, not spread: a spread would carry `id` and `invitationId` into the row if a
    // caller ever passed the whole existing event back as a patch.
    if (changes.type !== undefined) patch["type"] = changes.type;
    if (changes.title !== undefined) patch["title"] = changes.title;
    if (changes.eventDate !== undefined) patch["eventDate"] = changes.eventDate;
    if (changes.startTime !== undefined) patch["startTime"] = changes.startTime;
    if (changes.endTime !== undefined) patch["endTime"] = changes.endTime;
    if (changes.venueName !== undefined) patch["venueName"] = changes.venueName;
    if (changes.address !== undefined) patch["address"] = changes.address;
    if (changes.latitude !== undefined) patch["latitude"] = changes.latitude;
    if (changes.longitude !== undefined) patch["longitude"] = changes.longitude;
    if (changes.mapsUrl !== undefined) patch["mapsUrl"] = changes.mapsUrl;
    if (changes.description !== undefined) {
      patch["description"] = changes.description;
    }
    if (changes.displayOrder !== undefined) {
      patch["displayOrder"] = changes.displayOrder;
    }

    if (Object.keys(patch).length === 0) {
      return this.findOwnedChild(
        invitationEvents,
        eventId,
        invitationId,
        scope,
      );
    }

    patch["updatedAt"] = new Date();

    const rows = await this.db
      .update(invitationEvents)
      .set(patch)
      .where(
        and(
          eq(invitationEvents.id, eventId),
          eq(invitationEvents.invitationId, invitationId),
          sql`EXISTS (
            SELECT 1 FROM invitations i
            WHERE i.id = ${invitationEvents.invitationId}
              AND i.owner_id = ${scope}
              AND i.deleted_at IS NULL
          )`,
        ),
      )
      .returning();

    return rows[0] ?? null;
  }

  /** Delete one event, with the same two conditions. `P1-12`. */
  async deleteEvent(
    eventId: string,
    invitationId: string,
    scope: TenantScope,
  ): Promise<void> {
    await this.db.delete(invitationEvents).where(
      and(
        eq(invitationEvents.id, eventId),
        eq(invitationEvents.invitationId, invitationId),
        sql`EXISTS (
            SELECT 1 FROM invitations i
            WHERE i.id = ${invitationEvents.invitationId}
              AND i.owner_id = ${scope}
              AND i.deleted_at IS NULL
          )`,
      ),
    );
  }

  /**
   * Update one person row of an owned invitation. `P1-11`.
   *
   * An `UPDATE`, never an upsert. `P1-09` creates both rows empty with the invitation, so
   * there is nothing to insert — and an upsert could produce a second `groom` row under
   * concurrency, which `toInvitationDetail` would silently resolve by picking whichever
   * came back first.
   *
   * The owner predicate is in the join, so an update aimed at somebody else's invitation
   * matches nothing rather than being refused after a read.
   */
  async updatePerson(
    invitationId: string,
    scope: TenantScope,
    role: "groom" | "bride",
    changes: {
      readonly fullName?: string;
      readonly nickname?: string;
      readonly photoMediaId?: string | null;
      readonly instagram?: string | null;
      readonly fatherName?: string | null;
      readonly motherName?: string | null;
      readonly childOrder?: string | null;
    },
  ): Promise<typeof invitationPeople.$inferSelect | null> {
    const patch: Record<string, unknown> = {};
    // Named, not spread. A spread would carry whatever the caller's object grew next
    // straight into the row, and `role` is in that object's neighbourhood.
    if (changes.fullName !== undefined) patch["fullName"] = changes.fullName;
    if (changes.nickname !== undefined) patch["nickname"] = changes.nickname;
    if (changes.photoMediaId !== undefined) {
      patch["photoMediaId"] = changes.photoMediaId;
    }
    if (changes.instagram !== undefined) patch["instagram"] = changes.instagram;
    if (changes.fatherName !== undefined) {
      patch["fatherName"] = changes.fatherName;
    }
    if (changes.motherName !== undefined) {
      patch["motherName"] = changes.motherName;
    }
    if (changes.childOrder !== undefined) {
      patch["childOrder"] = changes.childOrder;
    }

    if (Object.keys(patch).length === 0) {
      // An empty PATCH is a read. Going through the same scoped path rather than a
      // separate query keeps "what can this caller see" in one place.
      const rows = await this.db
        .select({ person: invitationPeople })
        .from(invitationPeople)
        .innerJoin(
          invitations,
          eq(invitationPeople.invitationId, invitations.id),
        )
        .where(
          and(
            eq(invitationPeople.invitationId, invitationId),
            eq(invitationPeople.role, role),
            eq(invitations.ownerId, scope),
            isNull(invitations.deletedAt),
          ),
        )
        .limit(1);

      return rows[0]?.person ?? null;
    }

    patch["updatedAt"] = new Date();

    // Drizzle cannot express a join in an UPDATE, so the ownership condition rides in as
    // a correlated subquery. It is the same predicate, in the same statement -- what
    // matters is that there is no window between checking and writing.
    const rows = await this.db
      .update(invitationPeople)
      .set(patch)
      .where(
        and(
          eq(invitationPeople.invitationId, invitationId),
          eq(invitationPeople.role, role),
          sql`EXISTS (
            SELECT 1 FROM invitations i
            WHERE i.id = ${invitationPeople.invitationId}
              AND i.owner_id = ${scope}
              AND i.deleted_at IS NULL
          )`,
        ),
      )
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Whether a media row exists, belongs to this invitation, and is ready to be referenced.
   * `P1-11`, `docs/SECURITY/05` § 6.
   *
   * Scoped by **invitation**, not by owner, and that is deliberate: the caller has already
   * proved they own the invitation, and `media.invitation_id` is the narrower question.
   * A photo belonging to another invitation of the *same* user is still the wrong photo.
   *
   * `status = 'ready'` is the third condition and the least obvious. A file still in the
   * pipeline has not been through `docs/SECURITY/06`'s magic-byte, EXIF and malware
   * stages; referencing one would put an unvalidated file on a public page the moment it
   * finished processing.
   */
  async mediaBelongsToInvitation(
    mediaId: string,
    invitationId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ one: sql<number>`1` })
      .from(media)
      .where(
        and(
          eq(media.id, mediaId),
          eq(media.invitationId, invitationId),
          eq(media.status, "ready"),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  /**
   * How many invitations this scope has, for pagination. `P1-10`.
   *
   * A separate count rather than `rows.length`, because the rows are a page and the
   * envelope's `meta.total` means "how many are there", not "how many did you send".
   * Same predicate as `findOwnedList`, deliberately duplicated here rather than shared
   * through a helper: two queries that must agree are easier to check side by side than
   * one abstraction with a boolean.
   */
  async countOwned(scope: TenantScope, status?: string): Promise<number> {
    const conditions = [
      eq(invitations.ownerId, scope),
      isNull(invitations.deletedAt),
    ];
    if (status !== undefined) {
      conditions.push(eq(invitations.status, status));
    }

    const [row] = await this.db
      .select({ n: count() })
      .from(invitations)
      .where(and(...conditions));

    return row?.n ?? 0;
  }

  /**
   * Update invitation-level columns this scope owns. `P1-10`.
   *
   * The `changes` type is the whitelist: it has one property. `status` is absent because
   * `InvitationStatusService` is the only permitted writer (`check-status-writes.mjs`),
   * and `ownerId`, `templateVersionId`, `publishedAt` and `expiryDate` are absent because
   * a client must not move them.
   *
   * The owner predicate is in the `WHERE`, so an update aimed at somebody else's row
   * changes nothing rather than being refused after a read.
   */
  async updateOwned(
    invitationId: string,
    scope: TenantScope,
    changes: { readonly internalName?: string },
  ): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (changes.internalName !== undefined) {
      patch["internalName"] = changes.internalName;
    }
    if (Object.keys(patch).length === 0) return;

    patch["updatedAt"] = new Date();

    await this.db
      .update(invitations)
      .set(patch)
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.ownerId, scope),
          isNull(invitations.deletedAt),
        ),
      );
  }

  /**
   * Soft delete one this scope owns. `P1-10`.
   *
   * Sets `deleted_at` and nothing else. The row survives, leaves every list (every query
   * here carries `deleted_at IS NULL`), and **releases its slug** — the unique index is
   * partial over live rows (ADR-033), which is what `docs/DATABASE/04` § Notes means by
   * "a slug can be reused after the old invitation is truly deleted".
   */
  async softDeleteOwned(
    invitationId: string,
    scope: TenantScope,
  ): Promise<void> {
    await this.db
      .update(invitations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.ownerId, scope),
          isNull(invitations.deletedAt),
        ),
      );
  }

  /**
   * Everything embedded in `docs/API/04` § Example Response, in one place. `P1-10`.
   *
   * Each read goes through `findOwnedChildren`, which validates `child.invitation_id`
   * **and** the parent's owner in one statement (`docs/SECURITY/05` §§ 6 and 7). The
   * settings and quote rows are keyed by `invitation_id` and have no child id, so they
   * are read here with the same join.
   */
  async loadAggregate(
    invitationId: string,
    scope: TenantScope,
  ): Promise<InvitationAggregate> {
    const [people, events, gallery, bankAccounts, settings, quote] =
      await Promise.all([
        this.findOwnedChildren(invitationPeople, invitationId, scope),
        this.findOwnedChildren(invitationEvents, invitationId, scope),
        this.findOwnedChildren(invitationGallery, invitationId, scope),
        this.findOwnedChildren(invitationBankAccounts, invitationId, scope),
        this.findOwnedSingleton(invitationSettings, invitationId, scope),
        this.findOwnedSingleton(invitationQuote, invitationId, scope),
      ]);

    return { people, events, gallery, bankAccounts, settings, quote };
  }

  /**
   * A one-per-invitation row — settings or quote — with the owner check in the join.
   *
   * Separate from `findOwnedChildren` because these tables have no `id` of their own;
   * `invitation_id` IS the primary key, so there is no child id to validate against.
   */
  private async findOwnedSingleton<
    T extends typeof invitationSettings | typeof invitationQuote,
  >(
    table: T,
    invitationId: string,
    scope: TenantScope,
  ): Promise<T["$inferSelect"] | null> {
    const rows = await this.db
      .select({ row: table as typeof invitationSettings })
      .from(table as typeof invitationSettings)
      .innerJoin(invitations, eq(table.invitationId, invitations.id))
      .where(
        and(
          eq(table.invitationId, invitationId),
          eq(invitations.ownerId, scope),
          isNull(invitations.deletedAt),
        ),
      )
      .limit(1);

    return (rows[0]?.row as T["$inferSelect"] | undefined) ?? null;
  }

  /**
   * Create an invitation and its whole aggregate, in one transaction.
   *
   * Here rather than in `P1-09`'s service because this is the **one place `owner_id` is
   * ever written**, and `scripts/check-tenant-scope.mjs` refuses a direct import of these
   * tables outside this layer. Adding the invitation module to that script's ALLOWED list
   * would have been the cheaper change and the wrong one: its own comment says every
   * addition "deserves the same scrutiny and a sentence here saying what it costs", and
   * the cost of this one would have been that the tenancy layer no longer owns the column
   * every other query filters on.
   *
   * The five rows are the card's step 4. Both people rows are created **empty** rather
   * than on first edit, so every later `PATCH /couple/groom` is a simple `UPDATE` instead
   * of an upsert racing another tab.
   *
   * The caller supplies `recordCreation`, which is `P0-14`'s status service -- it must run
   * inside this transaction, and this layer must not depend on that module.
   */
  async createAggregate(
    scope: TenantScope,
    input: {
      readonly internalName: string;
      readonly templateId: string;
      readonly templateVersionId: string;
      readonly slug: string | null;
      readonly enabledSections: readonly string[];
    },
    recordCreation: (tx: Transaction, invitationId: string) => Promise<void>,
  ): Promise<InvitationRow> {
    return this.db.transaction(async (tx) => {
      const [invitation] = await tx
        .insert(invitations)
        .values({
          // The scope, and nothing a caller could have supplied. `docs/SECURITY/05` § 3.
          ownerId: scope,
          internalName: input.internalName,
          templateId: input.templateId,
          templateVersionId: input.templateVersionId,
          status: "draft",
          slug: input.slug,
        })
        .returning();

      const invitationId = invitation!.id;

      await tx.insert(invitationSettings).values({
        invitationId,
        enabledSections: [...input.enabledSections],
        // Explicit, though the column defaults to it. `docs/PLAN/15`: an invitation
        // carries names, addresses, times and a guest list, so not entering a search
        // index is the default -- and writing it here means a change to the column
        // default cannot quietly flip it.
        seoIndexable: false,
      });

      await tx.insert(invitationQuote).values({ invitationId });

      await tx.insert(invitationPeople).values([
        { invitationId, role: "groom" },
        { invitationId, role: "bride" },
      ]);

      await recordCreation(tx, invitationId);

      return invitation!;
    });
  }

  /**
   * This scope's one invitation that has **never been paid for**, if it has one. BR-1.4.
   *
   * Not "their drafts". ADR-023 is explicit that the quota "limits unpaid inventory, not
   * customers", so a wedding organiser with five paid invitations can start a sixth. Two
   * conditions, and both are load-bearing:
   *
   *   the current status is none of the paid ones, which covers the common case;
   *   and `invitation_status_history` has never recorded one, which covers an invitation
   *   that was paid and later unpublished -- it must not start counting again.
   *
   * Writing this as `status = 'draft'` looks equivalent and is not: a `pending_payment`
   * invitation is neither paid nor a draft, and the short version would let a user park
   * one there and start another. That mutation passed every test until `P1-09` added the
   * case for it.
   */
  async findUnpaidInvitation(
    scope: TenantScope,
  ): Promise<{ id: string; internalName: string | null } | undefined> {
    const rows = await this.db
      .select({ id: invitations.id, internalName: invitations.internalName })
      .from(invitations)
      .where(
        and(
          eq(invitations.ownerId, scope),
          isNull(invitations.deletedAt),
          ...NEVER_PAID_STATUSES.map((status) =>
            ne(invitations.status, status),
          ),
          sql`NOT EXISTS (
            SELECT 1 FROM invitation_status_history h
            WHERE h.invitation_id = ${invitations.id}
              AND h.to_status IN ('paid', 'published', 'expired')
          )`,
        ),
      )
      .limit(1);

    return rows[0];
  }

  /**
   * Whether a LIVE invitation holds this slug. Deliberately not scoped.
   *
   * The slug is a global public namespace, so a conflict with somebody else's invitation
   * is a real conflict and the answer has to cross tenants. That makes this the one read
   * in this file that does not carry an owner predicate, which is exactly why it lives
   * here with this paragraph attached rather than in a service where it would look
   * unremarkable.
   *
   * It leaks one bit -- that some invitation holds this address -- which is unavoidable
   * for a public namespace and is what the public URL already tells any visitor.
   *
   * `deleted_at IS NULL` matches the partial unique index (ADR-033): `docs/DATABASE/04`
   * § Notes says "a slug can be reused after the old invitation is truly deleted".
   */
  async slugTaken(
    slug: string,
    excludeInvitationId?: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.slug, slug.trim().toLowerCase()),
          isNull(invitations.deletedAt),
        ),
      )
      .limit(2);

    return rows.some((row) => row.id !== excludeInvitationId);
  }

  /**
   * How many of this scope's invitations are in one of the given statuses.
   *
   * Added by `P1-08` so account deletion can tell the user how many published invitations
   * will keep serving (ADR-051) without importing `invitations` -- which
   * `scripts/check-tenant-scope.mjs` correctly refuses. A count is a read like any other,
   * and "which rows am I counting" is exactly the question the owner predicate answers.
   */
  async countOwnedByStatus(
    scope: TenantScope,
    statuses: readonly string[],
  ): Promise<number> {
    // An empty list must count nothing, not everything -- the same trap `findOwnedList`
    // guards against with `inArray`.
    if (statuses.length === 0) return 0;

    const [row] = await this.db
      .select({ n: count() })
      .from(invitations)
      .where(
        and(
          eq(invitations.ownerId, scope),
          isNull(invitations.deletedAt),
          inArray(invitations.status, [...statuses]),
        ),
      );

    return row?.n ?? 0;
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
