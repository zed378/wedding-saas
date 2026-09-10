import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import {
  invitations,
  invitationStatusHistory,
} from "../../infra/db/schema/index";
import { BusinessRuleError, NotFoundError } from "../../http/errors";
import { logger } from "../logging/logger";
import type { Transaction } from "../db/transaction";

/**
 * The only path that writes `invitations.status`.
 *
 * `docs/DATABASE/04` § Notes: "Every `status` transition MUST write a new row to
 * `invitation_status_history` — done at the service layer, not via a DB trigger, so
 * `changed_by`/`reason` can be filled from the application context."
 *
 * A trigger would guarantee the row exists but could not say who caused it or why, and
 * "the status changed at 03:14 and nobody knows why" is the exact question an audit
 * trail is for. So it lives here — and `scripts/check-status-writes.mjs` fails the build
 * if anything else writes the column, because a rule enforced only by convention is a
 * rule that lasts until the first hotfix.
 *
 * The service also enforces WHO may make each transition, which is a different question
 * from whose invitation it is. Ownership is `P0-11`'s and is assumed already checked;
 * duplicating it here would create a second place for it to be wrong.
 *
 * **That assumption is load-bearing and unenforced.** This module is on the allowlist in
 * `scripts/check-tenant-scope.mjs`, so it may query `invitations` directly -- and it does
 * not filter by owner. A caller that passes an id it has not checked will transition
 * someone else's invitation and no guard will object. Every call site must obtain the id
 * from `InvitationRepository.findOwned` or `ownsInvitation` first.
 */

export type InvitationStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "published"
  | "expired"
  | "soft_deleted";

/**
 * Who is making the change.
 *
 * `SYSTEM` is not a lesser actor — some transitions are reserved TO it.
 * `pending_payment → paid` is `SYSTEM` only even for an admin, because `docs/PLAN/06`
 * allows it solely through the verified payment webhook and `docs/SECURITY/07` makes
 * payment status server-decided.
 */
export type ActorKind = "USER" | "ADMIN" | "SYSTEM";

export interface Actor {
  readonly kind: ActorKind;
  /** Null for SYSTEM: an expiry sweep has no acting user (`docs/DATABASE/04`). */
  readonly userId: string | null;
}

interface Rule {
  readonly to: InvitationStatus;
  readonly by: readonly ActorKind[];
  /** Backward transitions must say why (`docs/PLAN/06` § Transition Rules). */
  readonly reasonRequired?: boolean;
  readonly note: string;
}

/**
 * The state machine from `docs/PLAN/06`, plus the two edges other documents add.
 * Anything not listed is rejected — an allowlist, so a transition nobody designed
 * cannot happen by accident.
 */
const TRANSITIONS: Record<InvitationStatus, readonly Rule[]> = {
  draft: [{ to: "pending_payment", by: ["USER"], note: "checkout" }],

  pending_payment: [
    // SYSTEM only. Not an admin, not a user: docs/PLAN/06 says this happens solely
    // through validated webhook processing, and docs/SECURITY/07 makes payment status
    // server-decided. An admin who could set `paid` by hand is an admin who can grant
    // a free product, and that is a fraud path rather than a support tool.
    { to: "paid", by: ["SYSTEM"], note: "payment webhook confirmed" },
    {
      to: "draft",
      by: ["SYSTEM", "USER"],
      note: "payment failed, expired, or cancelled",
    },
  ],

  paid: [{ to: "published", by: ["USER", "ADMIN"], note: "publish" }],

  published: [
    {
      to: "paid",
      by: ["USER"],
      note: "unpublish — stays paid, republishable free",
    },
    { to: "expired", by: ["SYSTEM"], note: "expiry_date passed, daily job" },
  ],

  expired: [
    { to: "published", by: ["SYSTEM"], note: "renewal payment confirmed" },
    {
      to: "soft_deleted",
      by: ["SYSTEM"],
      note: "90 days without renewal, BR-9.1",
    },
  ],

  // Terminal for this service. `hard_deleted` is not a status -- docs/PLAN/06 shows it
  // as an outcome and docs/DATABASE/04's CHECK omits it. The row is deleted, not marked.
  soft_deleted: [],
};

/**
 * Edges that apply from ANY state.
 *
 *   refund  -- ADR-019: a refund returns the invitation to `draft` from whatever it
 *              held, including directly from `published`. `paid` would return the money
 *              and leave the customer the product.
 *   delete  -- docs/API/04 offers `DELETE /invitations/:id` as a soft-delete at any
 *              time. docs/PLAN/06's diagram does not draw this edge because it draws
 *              the automatic lifecycle; the endpoint still needs it.
 */
const FROM_ANY: readonly Rule[] = [
  {
    to: "draft",
    by: ["ADMIN"],
    reasonRequired: true,
    note: "refund (ADR-019)",
  },
  { to: "soft_deleted", by: ["USER", "ADMIN"], note: "user or admin deletion" },
];

@Injectable()
export class InvitationStatusService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Change status and record the transition, atomically.
   *
   * Both writes are in one transaction: a status change that commits without its
   * history row leaves an invitation in a state nobody can explain, which is worse than
   * the change failing.
   *
   * Ownership is NOT checked here — the caller passes an id `P0-11` has already proven
   * belongs to the actor.
   */
  async transition(
    invitationId: string,
    to: InvitationStatus,
    actor: Actor,
    reason?: string,
  ): Promise<{ from: InvitationStatus; to: InvitationStatus }> {
    return this.db.transaction(async (tx) => {
      // Locked for the length of the transaction. Without this, two concurrent
      // requests both read `paid`, both decide the transition is legal, and both
      // write -- producing two history rows describing incompatible journeys.
      const [current] = await tx
        .select({ status: invitations.status })
        .from(invitations)
        .where(eq(invitations.id, invitationId))
        .for("update")
        .limit(1);

      if (current === undefined) throw new NotFoundError();

      const from = current.status as InvitationStatus;
      assertAllowed(from, to, actor, reason);

      await tx
        .update(invitations)
        .set({ status: to })
        // The `from` in the WHERE is a second guard: if anything changed the status
        // between the lock and here, this updates nothing and the check below throws
        // rather than writing a history row describing a transition that did not occur.
        .where(
          and(eq(invitations.id, invitationId), eq(invitations.status, from)),
        );

      await this.writeHistory(tx, invitationId, from, to, actor, reason);

      logger.info(
        {
          context: {
            invitation_id: invitationId,
            from,
            to,
            actor: actor.kind,
            ...(reason !== undefined ? { reason } : {}),
          },
        },
        "invitation status changed",
      );

      return { from, to };
    });
  }

  /**
   * The initial row, written when an invitation is created.
   *
   * `from_status` is null -- there was no previous state. Separate from `transition`
   * because there is nothing to lock or validate, and squeezing creation into the
   * transition path would mean inventing a "nothing" state for the machine.
   */
  async recordCreation(
    tx: Transaction,
    invitationId: string,
    actor: Actor,
  ): Promise<void> {
    await tx.insert(invitationStatusHistory).values({
      invitationId,
      fromStatus: null,
      toStatus: "draft",
      changedBy: actor.userId,
      reason: "created",
    });
  }

  private async writeHistory(
    tx: Transaction,
    invitationId: string,
    from: InvitationStatus,
    to: InvitationStatus,
    actor: Actor,
    reason?: string,
  ): Promise<void> {
    await tx.insert(invitationStatusHistory).values({
      invitationId,
      fromStatus: from,
      toStatus: to,
      // Null for SYSTEM. `docs/DATABASE/04` makes this nullable precisely so an expiry
      // sweep does not have to invent an acting user; the reason carries the actor.
      changedBy: actor.userId,
      reason: reason ?? defaultReason(from, to, actor),
    });
  }
}

function assertAllowed(
  from: InvitationStatus,
  to: InvitationStatus,
  actor: Actor,
  reason: string | undefined,
): void {
  if (from === to) {
    throw new BusinessRuleError(
      "INVALID_STATUS_TRANSITION",
      "The invitation is already in that state.",
    );
  }

  /**
   * ALL rules for this edge, not the first one found.
   *
   * One edge can have several rules because it happens for several reasons.
   * `expired -> soft_deleted` is both the 90-day automatic sweep (SYSTEM, BR-9.1) and a
   * user pressing delete (USER, docs/API/04). Taking only the state-specific rule made
   * the second impossible: a user could delete an invitation in any state except an
   * expired one, which is the state they are most likely to want gone.
   */
  const rules = [
    ...TRANSITIONS[from].filter((r) => r.to === to),
    ...FROM_ANY.filter((r) => r.to === to),
  ];

  if (rules.length === 0) {
    throw new BusinessRuleError(
      "INVALID_STATUS_TRANSITION",
      `An invitation cannot go from ${from} to ${to}.`,
    );
  }

  const rule = rules.find((r) => r.by.includes(actor.kind));

  if (rule === undefined) {
    // Deliberately does not say which actor WOULD be allowed. That is internal policy,
    // and telling a user "an admin could do this" invites the next request.
    throw new BusinessRuleError(
      "INVALID_STATUS_TRANSITION",
      `That change is not available from the ${from} state.`,
    );
  }

  if (
    rule.reasonRequired === true &&
    (reason === undefined || reason.trim().length === 0)
  ) {
    // docs/PLAN/06: backward transitions are admin-only and "must include a reason".
    // The reason is what someone reads months later deciding whether a refund was
    // legitimate, and the only moment anyone knows it is now.
    throw new BusinessRuleError(
      "REASON_REQUIRED",
      "This change requires a reason to be recorded.",
    );
  }
}

/** A description for history rows whose caller gave none. Never empty. */
function defaultReason(
  from: InvitationStatus,
  to: InvitationStatus,
  actor: Actor,
): string {
  // Same "all rules" lookup as assertAllowed, and for the same reason: one edge can
  // have several rules, and the note that describes what happened is the one belonging
  // to the actor who did it.
  const rules = [
    ...TRANSITIONS[from].filter((r) => r.to === to),
    ...FROM_ANY.filter((r) => r.to === to),
  ];
  const rule = rules.find((r) => r.by.includes(actor.kind)) ?? rules[0];
  return `${actor.kind.toLowerCase()}: ${rule?.note ?? `${from} -> ${to}`}`;
}
