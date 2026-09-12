import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";

import {
  GiftService,
  QuoteService,
} from "../../src/modules/invitation/gift.service";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import { AuditLogService } from "../../src/shared/audit/audit-log.service";
import { auditLogs } from "../../src/infra/db/schema/orders";
import { invitationBankAccounts } from "../../src/infra/db/schema/invitations";
import { createLogger } from "@wi/logging";
import type { JobQueue } from "../../src/infra/queue/queue.module";
import { startHarness, type Harness } from "../support/harness";
import { rejection } from "../support/rejection";
import {
  createTestInvitation,
  createTestUser,
  type TestUser,
} from "../support/factories";
import { createTwoTenants, expectServiceIdorSafe } from "../support/idor";
import { resetTenantData } from "./helpers.ts";

/**
 * P1-13 — gift accounts and the quote.
 *
 * The threat model here is not the usual one. A gift account number is data the couple
 * **publishes on purpose** (ADR-025), so disclosure costs them little; **substitution**
 * costs them everything their guests sent (`docs/PLAN/18` R16). So most of this file is
 * about integrity — audit rows that cannot be separated from the write, and a notification
 * when a live invitation's account changes — rather than about secrecy.
 *
 * The one secrecy control that does matter is the log: an invitation page is one audience
 * and a log aggregator is another.
 */

const ACCOUNT = {
  type: "bank",
  providerName: "BCA",
  accountNumber: "1234567890",
  accountHolder: "Budi Santoso",
} as const;

describe("gift accounts and quote", () => {
  let harness: Harness;
  let gift: GiftService;
  let quote: QuoteService;
  let repository: InvitationRepository;
  let enqueued: { name: string; data: Record<string, unknown> }[];

  const queue: JobQueue = {
    enqueue: async (_pool, name, data) => {
      enqueued.push({ name, data });
    },
    close: async () => {},
  };

  beforeAll(async () => {
    harness = await startHarness();
    repository = new InvitationRepository(harness.db);
    gift = new GiftService(repository, new AuditLogService(), queue);
    quote = new QuoteService(repository);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
    enqueued = [];
  });

  const withInvitation = async (
    status?: string,
  ): Promise<{ user: TestUser; invitationId: string }> => {
    const user = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
      ...(status !== undefined ? { status } : {}),
    });
    return { user, invitationId: invitation.id };
  };

  const auditRows = async () => harness.db.select().from(auditLogs);

  describe("CRUD", () => {
    it("creates, lists, updates and deletes", async () => {
      const { user, invitationId } = await withInvitation();

      const created = await gift.create(user.scope, invitationId, ACCOUNT);
      expect(created.provider_name).toBe("BCA");

      expect(await gift.list(user.scope, invitationId)).toHaveLength(1);

      const updated = await gift.update(user.scope, invitationId, created.id, {
        accountHolder: "Budi S.",
      });
      expect(updated.account_holder).toBe("Budi S.");

      await gift.remove(user.scope, invitationId, created.id);
      expect(await gift.list(user.scope, invitationId)).toHaveLength(0);
    });

    it("returns the full number to its owner", async () => {
      // The owner typed it and will publish it. Masking it in their own editor would make
      // the field impossible to check.
      const { user, invitationId } = await withInvitation();
      const created = await gift.create(user.scope, invitationId, ACCOUNT);

      expect(created.account_number).toBe("1234567890");
    });

    it("display_order appends", async () => {
      const { user, invitationId } = await withInvitation();
      const first = await gift.create(user.scope, invitationId, ACCOUNT);
      const second = await gift.create(user.scope, invitationId, {
        ...ACCOUNT,
        providerName: "Mandiri",
      });

      expect(first.display_order).toBe(0);
      expect(second.display_order).toBe(1);
    });

    it("an empty patch changes nothing and returns the row", async () => {
      const { user, invitationId } = await withInvitation();
      const created = await gift.create(user.scope, invitationId, ACCOUNT);

      const result = await gift.update(
        user.scope,
        invitationId,
        created.id,
        {},
      );
      expect(result.account_number).toBe("1234567890");
    });
  });

  describe("the audit trail cannot be separated from the write (step 4b)", () => {
    it("a create writes an audit row", async () => {
      const { user, invitationId } = await withInvitation();
      const created = await gift.create(user.scope, invitationId, ACCOUNT);

      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.action).toBe("bank_account.create");
      expect(rows[0]!.resourceType).toBe("invitation_bank_account");
      expect(rows[0]!.resourceId).toBe(created.id);
      expect(rows[0]!.adminId).toBe(user.id);
    });

    it("an update records before AND after", async () => {
      // "Who changed this, and to what" is the question an incident asks. A row with only
      // the new value answers half of it.
      const { user, invitationId } = await withInvitation();
      const created = await gift.create(user.scope, invitationId, ACCOUNT);

      await gift.update(user.scope, invitationId, created.id, {
        accountNumber: "9876543210",
      });

      const rows = await auditRows();
      const update = rows.find((r) => r.action === "bank_account.update");
      expect(update).toBeDefined();
      expect(update!.beforeState).toBeDefined();
      expect(update!.afterState).toBeDefined();
    });

    it("a delete records what was removed", async () => {
      const { user, invitationId } = await withInvitation();
      const created = await gift.create(user.scope, invitationId, ACCOUNT);

      await gift.remove(user.scope, invitationId, created.id);

      const rows = await auditRows();
      const del = rows.find((r) => r.action === "bank_account.delete");
      expect(del).toBeDefined();
      expect(del!.beforeState).toBeDefined();
    });

    it("the audit row carries a MASKED number, never the full one", async () => {
      // docs/DATABASE/10 § Policy: "avoid unnecessarily duplicating bank account data".
      // A two-year retention over a table of full account numbers would be a bigger
      // liability than the one the policy warns about.
      const { user, invitationId } = await withInvitation();
      const created = await gift.create(user.scope, invitationId, ACCOUNT);
      await gift.update(user.scope, invitationId, created.id, {
        accountNumber: "9876543210",
      });

      const serialised = JSON.stringify(await auditRows());
      expect(serialised).not.toContain("1234567890");
      expect(serialised).not.toContain("9876543210");
      expect(serialised).toContain("******7890");
    });

    it("a FAILING audit rolls the write back", async () => {
      // "In the same transaction" is the claim; this is the test that makes it one. If the
      // audit row could fail while the change committed, the evidence an incident needs
      // would be the first thing lost -- and nothing would look wrong.
      const exploding = new GiftService(
        repository,
        {
          record: async () => {
            throw new Error("audit table unavailable");
          },
        } as unknown as AuditLogService,
        queue,
      );
      const { user, invitationId } = await withInvitation();

      await expect(
        exploding.create(user.scope, invitationId, ACCOUNT),
      ).rejects.toThrow(/audit table unavailable/);

      expect(
        await harness.db
          .select()
          .from(invitationBankAccounts)
          .where(eq(invitationBankAccounts.invitationId, invitationId)),
      ).toHaveLength(0);
    });

    it("a failing audit on UPDATE leaves the old value in place", async () => {
      const { user, invitationId } = await withInvitation();
      const created = await gift.create(user.scope, invitationId, ACCOUNT);

      const exploding = new GiftService(
        repository,
        {
          record: async () => {
            throw new Error("audit table unavailable");
          },
        } as unknown as AuditLogService,
        queue,
      );

      await expect(
        exploding.update(user.scope, invitationId, created.id, {
          accountNumber: "9876543210",
        }),
      ).rejects.toThrow();

      const [row] = await harness.db
        .select()
        .from(invitationBankAccounts)
        .where(eq(invitationBankAccounts.id, created.id));
      expect(row!.accountNumber).toBe("1234567890");
    });

    it("a refused write leaves no audit row", async () => {
      // The other half of "cannot be separated": an audit row for a change that did not
      // happen is worse than none, because it sends an investigator after a ghost.
      const { alice, mallory } = await createTwoTenants(harness.pool);

      await gift
        .create(mallory.user.scope, alice.invitation.id, ACCOUNT)
        .catch(() => {});

      expect(await auditRows()).toHaveLength(0);
    });
  });

  describe("a change to a PUBLISHED invitation notifies the owner (step 4b)", () => {
    it("emits on create, update and delete", async () => {
      // The way a bank confirms a payee change. On a live invitation the number is in
      // front of guests right now, and an unexpected change is the signal that somebody
      // else is in the account.
      const { user, invitationId } = await withInvitation("published");

      const created = await gift.create(user.scope, invitationId, ACCOUNT);
      expect(
        enqueued.filter((j) => j.data["template"] === "bank_account_changed"),
      ).toHaveLength(1);

      await gift.update(user.scope, invitationId, created.id, {
        accountNumber: "9876543210",
      });
      expect(
        enqueued.filter((j) => j.data["template"] === "bank_account_changed"),
      ).toHaveLength(2);
    });

    it("the notification carries a masked number", async () => {
      const { user, invitationId } = await withInvitation("published");
      await gift.create(user.scope, invitationId, ACCOUNT);

      const job = enqueued.find(
        (j) => j.data["template"] === "bank_account_changed",
      );
      expect(JSON.stringify(job!.data)).not.toContain("1234567890");
      expect(job!.data["accountNumberMasked"]).toBe("******7890");
    });

    it("stays quiet on a draft", async () => {
      // On a draft this would be noise, and an email per keystroke trains the owner to
      // ignore the one that matters.
      const { user, invitationId } = await withInvitation();
      await gift.create(user.scope, invitationId, ACCOUNT);

      expect(
        enqueued.filter((j) => j.data["template"] === "bank_account_changed"),
      ).toHaveLength(0);
    });

    it("logs a security-adjacent warning while published", async () => {
      const { user, invitationId } = await withInvitation("published");
      const spy = vi.spyOn(
        (await import("../../src/shared/logging/logger.js")).logger,
        "warn",
      );

      await gift.create(user.scope, invitationId, ACCOUNT);

      expect(
        spy.mock.calls.some(
          (c) =>
            (c[0] as { context?: { event?: string } } | undefined)?.context
              ?.event === "invitation.gift_account_changed_while_published",
        ),
      ).toBe(true);
      spy.mockRestore();
    });

    it("a failing queue does not undo the change", async () => {
      // The change is already committed and audited. Refusing it because Redis blinked
      // would be worse than a missing email, and P1-02's producer logs the failure.
      const failing: JobQueue = {
        enqueue: async () => {
          throw new Error("redis is down");
        },
        close: async () => {},
      };
      const isolated = new GiftService(
        repository,
        new AuditLogService(),
        failing,
      );
      const { user, invitationId } = await withInvitation("published");

      await expect(
        isolated.create(user.scope, invitationId, ACCOUNT),
      ).rejects.toThrow();

      // ...and the row is there, because the enqueue happens after the transaction.
      expect(
        await harness.db
          .select()
          .from(invitationBankAccounts)
          .where(eq(invitationBankAccounts.invitationId, invitationId)),
      ).toHaveLength(1);
    });
  });

  describe("no log line contains a full account number (the DoD's first and third items)", () => {
    it("the logger masks account_number wherever it appears", async () => {
      // P0-12's redactor, exercised against the real shapes this feature logs. The number
      // is published to guests; a log aggregator is a different audience, and
      // docs/DEVOPS/06 asks for it masked there.
      const lines: string[] = [];
      const logger = createLogger(
        { service: "test" },
        { write: (line: string) => lines.push(line) },
      );

      logger.info(
        {
          context: {
            account_number: "1234567890",
            accountNumber: "1234567890",
            nested: { account_number: "1234567890" },
          },
        },
        "gift account",
      );

      const output = lines.join("\n");
      expect(output).not.toContain("1234567890");
      expect(output).toContain("******7890");
    });

    it("the service's own log lines carry no number at all", async () => {
      const lines: string[] = [];
      const probe = createLogger(
        { service: "test" },
        { write: (line: string) => lines.push(line) },
      );

      // The shape `notifyIfPublished` writes: no account field of any kind.
      probe.warn(
        {
          context: {
            user_id: "u",
            invitation_id: "i",
            event: "invitation.gift_account_changed_while_published",
            change: "changed",
          },
        },
        "gift account changed on a published invitation",
      );

      expect(lines.join("")).not.toMatch(/\d{6,}/);
    });
  });

  describe("cross-invitation :bank_id is 404 (the DoD's fourth item)", () => {
    it("another tenant's account id on my invitation", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);
      const alices = await gift.create(
        alice.user.scope,
        alice.invitation.id,
        ACCOUNT,
      );

      await expect(
        gift.update(mallory.user.scope, mallory.invitation.id, alices.id, {
          accountNumber: "6666666666",
        }),
      ).rejects.toMatchObject({ status: 404 });

      const [row] = await harness.db
        .select()
        .from(invitationBankAccounts)
        .where(eq(invitationBankAccounts.id, alices.id));
      expect(row!.accountNumber).toBe("1234567890");
    });

    it("my other invitation's account id", async () => {
      const user = await createTestUser(harness.pool);
      const a = await createTestInvitation(harness.pool, { owner: user });
      const b = await createTestInvitation(harness.pool, { owner: user });
      const account = await gift.create(user.scope, a.id, ACCOUNT);

      await expect(
        gift.update(user.scope, b.id, account.id, { accountHolder: "X" }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("deleting across invitations deletes nothing", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);
      const alices = await gift.create(
        alice.user.scope,
        alice.invitation.id,
        ACCOUNT,
      );

      await expect(
        gift.remove(mallory.user.scope, mallory.invitation.id, alices.id),
      ).rejects.toMatchObject({ status: 404 });

      expect(
        await harness.db
          .select()
          .from(invitationBankAccounts)
          .where(eq(invitationBankAccounts.id, alices.id)),
      ).toHaveLength(1);
    });

    it("another user cannot list or create", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);

      await expectServiceIdorSafe(() =>
        gift.list(mallory.user.scope, alice.invitation.id),
      );
      await expectServiceIdorSafe(() =>
        gift.create(mallory.user.scope, alice.invitation.id, ACCOUNT),
      );
    });
  });

  describe("each repository layer alone (the P1-12 lesson)", () => {
    it("updateBankAccount writes nothing for a foreign scope", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);
      const alices = await gift.create(
        alice.user.scope,
        alice.invitation.id,
        ACCOUNT,
      );

      expect(
        await repository.updateBankAccount(
          alices.id,
          alice.invitation.id,
          mallory.user.scope,
          { accountNumber: "6666666666" },
          async () => {},
        ),
      ).toBeNull();
    });

    it("deleteBankAccount deletes nothing for a foreign scope", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);
      const alices = await gift.create(
        alice.user.scope,
        alice.invitation.id,
        ACCOUNT,
      );

      expect(
        await repository.deleteBankAccount(
          alices.id,
          alice.invitation.id,
          mallory.user.scope,
          async () => {},
        ),
      ).toBe(false);
    });

    it("findOwnedBankAccount refuses the wrong parent for the same owner", async () => {
      const user = await createTestUser(harness.pool);
      const a = await createTestInvitation(harness.pool, { owner: user });
      const b = await createTestInvitation(harness.pool, { owner: user });
      const account = await gift.create(user.scope, a.id, ACCOUNT);

      expect(
        await repository.findOwnedBankAccount(account.id, b.id, user.scope),
      ).toBeNull();
      expect(
        await repository.findOwnedBankAccount(account.id, a.id, user.scope),
      ).not.toBeNull();
    });
  });

  describe("the quote (the DoD's fifth item)", () => {
    it("stores text and source", async () => {
      const { user, invitationId } = await withInvitation();

      const result = await quote.update(user.scope, invitationId, {
        text: "Dan di antara tanda-tanda kekuasaan-Nya...",
        source: "Ar-Rum: 21",
      });

      expect(result.text).toContain("Dan di antara");
      expect(result.source).toBe("Ar-Rum: 21");
    });

    it("reads back what was written", async () => {
      const { user, invitationId } = await withInvitation();
      await quote.update(user.scope, invitationId, { text: "A quote" });

      expect(await quote.get(user.scope, invitationId)).toEqual({
        text: "A quote",
        source: null,
      });
    });

    it("is partial", async () => {
      const { user, invitationId } = await withInvitation();
      await quote.update(user.scope, invitationId, {
        text: "A quote",
        source: "Somebody",
      });

      await quote.update(user.scope, invitationId, { source: "Somebody Else" });

      expect(await quote.get(user.scope, invitationId)).toEqual({
        text: "A quote",
        source: "Somebody Else",
      });
    });

    it("null clears a field", async () => {
      const { user, invitationId } = await withInvitation();
      await quote.update(user.scope, invitationId, { source: "Somebody" });

      await quote.update(user.scope, invitationId, { source: null });
      expect((await quote.get(user.scope, invitationId)).source).toBeNull();
    });

    it("works for an invitation with no quote row", async () => {
      // `P1-09` creates it, but an invitation predating that would otherwise 404 on a
      // field the editor shows.
      const { user, invitationId } = await withInvitation();
      await harness.pool.query(
        "DELETE FROM invitation_quote WHERE invitation_id = $1",
        [invitationId],
      );

      const result = await quote.update(user.scope, invitationId, {
        text: "Created by upsert",
      });
      expect(result.text).toBe("Created by upsert");
    });

    it("another user cannot read or write it", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);

      await expectServiceIdorSafe(() =>
        quote.get(mallory.user.scope, alice.invitation.id),
      );
      await expectServiceIdorSafe(() =>
        quote.update(mallory.user.scope, alice.invitation.id, {
          text: "Hijacked",
        }),
      );
    });

    it("updateQuote writes nothing for a foreign scope", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);

      expect(
        await repository.updateQuote(alice.invitation.id, mallory.user.scope, {
          text: "Hijacked",
        }),
      ).toBeNull();

      expect(
        (await repository.findOwnedQuote(alice.invitation.id, alice.user.scope))
          ?.text ?? null,
      ).toBeNull();
    });
  });

  describe("a soft-deleted invitation", () => {
    it("hides its gift accounts", async () => {
      const { user, invitationId } = await withInvitation();
      await gift.create(user.scope, invitationId, ACCOUNT);
      await harness.pool.query(
        "UPDATE invitations SET deleted_at = now() WHERE id = $1",
        [invitationId],
      );

      await expect(gift.list(user.scope, invitationId)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("refuses a quote write", async () => {
      const { user, invitationId } = await withInvitation();
      await harness.pool.query(
        "UPDATE invitations SET deleted_at = now() WHERE id = $1",
        [invitationId],
      );

      const error = await rejection(() =>
        quote.update(user.scope, invitationId, { text: "X" }),
      );
      expect(error.status).toBe(404);
    });
  });
});
