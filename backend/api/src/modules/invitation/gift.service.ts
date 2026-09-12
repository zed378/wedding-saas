import { Inject, Injectable } from "@nestjs/common";

import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import { NotFoundError } from "../../http/errors";
import { logger } from "../../shared/logging/logger";
import { maskTail } from "@wi/logging";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import {
  InvitationRepository,
  type InvitationBankAccountRow,
} from "../../shared/tenancy/invitation-repository";
import { AuditLogService } from "../../shared/audit/audit-log.service";
import { requireOwned, requireOwnership } from "../../shared/auth-middleware";
import type { BankAccountDto } from "./invitation.dto";

/**
 * P1-13 — gift accounts and the quote. `docs/API/04`, `docs/SECURITY/09` § Encryption.
 *
 * ## What this data is, and what it is not
 *
 * A gift account number is **personal data the couple enters in order to publish it**, so
 * a guest who cannot attend can send something. It is not a platform payment credential:
 * nothing in this system moves money with it, and on a published invitation with the gift
 * section enabled it is already served to every guest who opens the link (ADR-025,
 * `docs/SECURITY/00` § Data Classification).
 *
 * That is why it is **not column-encrypted**. Encryption would protect only the subset
 * that is not already public — drafts, and invitations with the gift section off — inside
 * a database that holds names, home addresses, venue coordinates, phone numbers and
 * complete guest lists in plaintext beside it. Storage-level encryption covers the whole
 * store; encrypting this one column would be a control that looks decisive and moves
 * almost nothing.
 *
 * ## The threat here is tampering, not disclosure
 *
 * `docs/PLAN/18` R16. An attacker who swaps the number on a **live** invitation collects
 * every guest's gift, and the couple may not find out until after the wedding. Disclosure
 * of a number the couple published on purpose costs them very little; substitution costs
 * them everything their guests sent.
 *
 * So the controls here are integrity controls, and all three are in this file:
 *
 *   every create, update and delete writes an audit row **in the same transaction**, so a
 *     change cannot commit without the evidence of who made it;
 *   a change to a **published** invitation emits an owner notification, the way a bank
 *     confirms a payee change — `P4-07` turns it into the email;
 *   the ownership check is not routine on these endpoints. It is the thing standing
 *     between a compromised account and the guests' money.
 */

export interface BankAccountInput {
  readonly type: string;
  readonly providerName: string;
  readonly accountNumber: string;
  readonly accountHolder: string;
  readonly displayOrder?: number | undefined;
}

export type BankAccountPatch = Partial<BankAccountInput>;

function toDto(row: InvitationBankAccountRow): BankAccountDto {
  return {
    id: row.id,
    type: row.type,
    provider_name: row.providerName,
    account_number: row.accountNumber,
    account_holder: row.accountHolder,
    display_order: row.displayOrder,
  };
}

/**
 * What an audit row and a notification may carry.
 *
 * The number is **masked**. `docs/DATABASE/10` § Policy asks to "avoid unnecessarily
 * duplicating bank account data" in audit rows, and a two-year retention over a table of
 * full account numbers would be a larger liability than the one the policy warns about.
 * The last four digits are enough for the owner to recognise which account changed, which
 * is the whole purpose of the notification.
 */
function auditable(row: InvitationBankAccountRow): Record<string, unknown> {
  return {
    type: row.type,
    provider_name: row.providerName,
    account_number_masked: maskTail(row.accountNumber),
    account_holder: row.accountHolder,
  };
}

@Injectable()
export class GiftService {
  constructor(
    private readonly repository: InvitationRepository,
    private readonly audit: AuditLogService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async list(
    scope: TenantScope,
    invitationId: string,
  ): Promise<BankAccountDto[]> {
    await requireOwned(
      () => this.repository.ownsInvitation(invitationId, scope),
      { scope, resourceType: "invitation", resourceId: invitationId },
    );

    const rows = await this.repository.findOwnedBankAccounts(
      invitationId,
      scope,
    );

    return [...rows].sort((a, b) => a.displayOrder - b.displayOrder).map(toDto);
  }

  async create(
    scope: TenantScope,
    invitationId: string,
    input: BankAccountInput,
  ): Promise<BankAccountDto> {
    const row = await this.repository.createBankAccount(
      invitationId,
      scope,
      {
        ...input,
        displayOrder:
          input.displayOrder ??
          (await this.repository.nextBankAccountOrder(invitationId, scope)),
      },
      (tx, created) =>
        this.audit.record(tx, {
          adminId: scope,
          action: "bank_account.create",
          resourceType: "invitation_bank_account",
          resourceId: created.id,
          reason: `gift account added to invitation ${invitationId}`,
          afterState: auditable(created),
        }),
    );

    if (row === null) throw new NotFoundError();

    await this.notifyIfPublished(scope, invitationId, "added", row);
    return toDto(row);
  }

  async update(
    scope: TenantScope,
    invitationId: string,
    bankAccountId: string,
    changes: BankAccountPatch,
  ): Promise<BankAccountDto> {
    const row = await this.repository.updateBankAccount(
      bankAccountId,
      invitationId,
      scope,
      changes,
      (tx, before, after) =>
        this.audit.record(tx, {
          adminId: scope,
          action: "bank_account.update",
          resourceType: "invitation_bank_account",
          resourceId: after.id,
          reason: `gift account changed on invitation ${invitationId}`,
          beforeState: auditable(before),
          afterState: auditable(after),
        }),
    );

    if (row === null) throw new NotFoundError();

    await this.notifyIfPublished(scope, invitationId, "changed", row);
    return toDto(row);
  }

  async remove(
    scope: TenantScope,
    invitationId: string,
    bankAccountId: string,
  ): Promise<void> {
    const removed = await this.repository.deleteBankAccount(
      bankAccountId,
      invitationId,
      scope,
      (tx, before) =>
        this.audit.record(tx, {
          adminId: scope,
          action: "bank_account.delete",
          resourceType: "invitation_bank_account",
          resourceId: before.id,
          reason: `gift account removed from invitation ${invitationId}`,
          beforeState: auditable(before),
        }),
    );

    if (!removed) throw new NotFoundError();
  }

  /**
   * Tell the owner, but only when the invitation is live.
   *
   * The distinction matters both ways. On a **draft** this would be noise — the couple is
   * editing, nobody can see it, and an email per keystroke trains them to ignore the one
   * that matters. On a **published** invitation the account number is in front of guests
   * right now, and an unexpected change is the signal that somebody else is in the
   * account.
   *
   * Enqueue failure does not fail the request: the change is already committed and
   * audited, and refusing it because Redis blinked would be worse. The failure is logged
   * (`P1-02`'s queue producer swallows and logs), which is what makes a missing
   * notification visible rather than silent.
   */
  private async notifyIfPublished(
    scope: TenantScope,
    invitationId: string,
    change: "added" | "changed" | "removed",
    row: InvitationBankAccountRow,
  ): Promise<void> {
    const invitation = await this.repository.findOwned(invitationId, scope);
    if (invitation === null || invitation.status !== "published") return;

    await this.queue.enqueue("general", "notification.send", {
      template: "bank_account_changed",
      userId: scope,
      invitationId,
      change,
      // Masked. The owner needs to recognise which account, not to be sent the number.
      accountNumberMasked: maskTail(row.accountNumber),
      providerName: row.providerName,
    });

    logger.warn(
      {
        context: {
          user_id: scope,
          invitation_id: invitationId,
          event: "invitation.gift_account_changed_while_published",
          change,
        },
      },
      "gift account changed on a published invitation",
    );
  }
}

/** `PATCH /invitations/:id/quote`. `docs/PLAN/08`: `{ text, source }`, nothing more. */
@Injectable()
export class QuoteService {
  constructor(private readonly repository: InvitationRepository) {}

  async get(
    scope: TenantScope,
    invitationId: string,
  ): Promise<{ text: string | null; source: string | null }> {
    await requireOwned(
      () => this.repository.ownsInvitation(invitationId, scope),
      { scope, resourceType: "invitation", resourceId: invitationId },
    );

    const row = await this.repository.findOwnedQuote(invitationId, scope);
    return { text: row?.text ?? null, source: row?.source ?? null };
  }

  async update(
    scope: TenantScope,
    invitationId: string,
    changes: {
      text?: string | null | undefined;
      source?: string | null | undefined;
    },
  ): Promise<{ text: string | null; source: string | null }> {
    const row = await requireOwnership(
      () => this.repository.updateQuote(invitationId, scope, changes),
      { scope, resourceType: "invitation", resourceId: invitationId },
    );

    return { text: row.text, source: row.source };
  }
}
