import { Injectable } from "@nestjs/common";

import { NotFoundError } from "../../http/errors";
import { logger } from "../../shared/logging/logger";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";
import { requireOwnership } from "../../shared/auth-middleware";
import { InvitationStatusService } from "../../shared/invitation-status/invitation-status.service";
import {
  toInvitationDetail,
  toInvitationSummary,
  type InvitationDetail,
  type InvitationSummary,
} from "./invitation.dto";

/**
 * P1-10 — list, detail, update and soft delete. `docs/API/04`.
 *
 * ## Every method takes a scope and passes it to the query
 *
 * `docs/SECURITY/05` § 5 names response-level filtering as the wrong implementation, by
 * name: loading everything and filtering in JavaScript works perfectly until somebody
 * drops a `.filter()` in a refactor, and then it leaks every tenant at once through an
 * endpoint that still looks correct. The owner predicate is in the SQL, in
 * `InvitationRepository`, and nothing here can reach a row without it.
 *
 * ## `requireOwnership` turns `null` into 404
 *
 * Not 403. `docs/SECURITY/04` § Note: "using 404 (not 403) for the 'exists but isn't
 * yours' case is a deliberate design choice to prevent resource enumeration via
 * status-code differences". The repository cannot tell us which it was, and that is the
 * feature.
 */

/** What `PATCH /invitations/:id` may change. Everything else is not a parameter. */
export interface UpdateInvitationInput {
  readonly internalName?: string;
}

@Injectable()
export class InvitationService {
  constructor(
    private readonly repository: InvitationRepository,
    private readonly status: InvitationStatusService,
  ) {}

  /**
   * The caller's invitations.
   *
   * `total` comes from a separate count rather than `rows.length`, because the rows are
   * a page. Both carry the same owner predicate.
   */
  async list(
    scope: TenantScope,
    options: { limit: number; offset: number; status?: string | undefined },
  ): Promise<{ items: InvitationSummary[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.repository.findOwnedList(scope, {
        limit: options.limit,
        offset: options.offset,
        ...(options.status !== undefined ? { status: options.status } : {}),
      }),
      this.repository.countOwned(scope, options.status),
    ]);

    return { items: rows.map(toInvitationSummary), total };
  }

  /**
   * The full aggregate. `docs/API/04` § Example Response.
   *
   * One query per child table, all of them scoped through the parent — the repository's
   * `findOwnedChildren` validates `child.invitation_id` **and** the parent's owner in one
   * statement (`docs/SECURITY/05` §§ 6 and 7), so a child cannot be reached by knowing
   * its id alone.
   */
  async detail(
    scope: TenantScope,
    invitationId: string,
  ): Promise<InvitationDetail> {
    const invitation = await requireOwnership(
      () => this.repository.findOwned(invitationId, scope),
      { scope, resourceType: "invitation", resourceId: invitationId },
    );

    const aggregate = await this.repository.loadAggregate(invitationId, scope);

    return toInvitationDetail(invitation, aggregate);
  }

  /**
   * Partial update of the invitation-level fields.
   *
   * `internal_name` is the only one. `status`, `owner_id`, `published_at`, `expiry_date`
   * and `template_version_id` are **not parameters** — the input type has no such
   * properties, so a client that sends them has nothing to reach. Status in particular
   * moves only through `InvitationStatusService`, and
   * `scripts/check-status-writes.mjs` fails the build on any other writer.
   */
  async update(
    scope: TenantScope,
    invitationId: string,
    changes: UpdateInvitationInput,
  ): Promise<InvitationDetail> {
    await requireOwnership(
      () =>
        this.repository.ownsInvitation(invitationId, scope) as Promise<
          true | null
        >,
      { scope, resourceType: "invitation", resourceId: invitationId },
    ).catch(() => {
      throw new NotFoundError();
    });

    if (changes.internalName !== undefined) {
      await this.repository.updateOwned(invitationId, scope, {
        internalName: changes.internalName.trim(),
      });
    }

    return this.detail(scope, invitationId);
  }

  /**
   * Soft delete.
   *
   * `deleted_at` is set and the row survives. Two consequences, both deliberate:
   * the invitation leaves every list because every query carries `deleted_at IS NULL`,
   * and its **slug is freed** — the partial unique index from ADR-033 covers live rows
   * only, and `docs/DATABASE/04` § Notes says "a slug can be reused after the old
   * invitation is truly deleted".
   *
   * The status transition is recorded through `P0-14`'s service, so the journey is
   * reconstructable.
   */
  async softDelete(scope: TenantScope, invitationId: string): Promise<void> {
    const invitation = await requireOwnership(
      () => this.repository.findOwned(invitationId, scope),
      { scope, resourceType: "invitation", resourceId: invitationId },
    );

    // The history row first, through the status service, because it is the thing that
    // needs the invitation to still be visible to its own queries.
    await this.status.transition(
      invitation.id,
      "soft_deleted",
      { kind: "USER", userId: scope },
      "deleted by owner",
    );

    await this.repository.softDeleteOwned(invitationId, scope);

    logger.info(
      {
        context: {
          user_id: scope,
          invitation_id: invitationId,
          event: "invitation.deleted",
        },
      },
      "invitation soft-deleted",
    );
  }
}
