import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { InvitationCreateService } from "../../src/modules/invitation/invitation-create.service";
import {
  SlugService,
  foldLeet,
} from "../../src/modules/invitation/slug.service";
import { InvitationStatusService } from "../../src/shared/invitation-status/invitation-status.service";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import {
  invitationPeople,
  invitationQuote,
  invitationSettings,
  invitationStatusHistory,
  invitations,
} from "../../src/infra/db/schema/invitations";
import {
  slugBlocklist,
  templateVersions,
} from "../../src/infra/db/schema/templates";
import { startHarness, type Harness } from "../support/harness";
import { rejection } from "../support/rejection";
import {
  createTestUser,
  createTestTemplateVersion,
} from "../support/factories";
import { resetTenantData } from "./helpers.ts";

/**
 * P1-09 — creating an invitation.
 *
 * The rules under test are business rules with named identifiers, and each is a rule
 * somebody will eventually be tempted to simplify:
 *
 *   **BR-3.1** the version is locked at creation, never resolved at read time — the whole
 *     reason an admin can edit a template without changing a sent invitation;
 *   **BR-3.3** a draft or deprecated version is refused for NEW invitations only;
 *   **BR-1.4** the free-draft quota counts what has never been PAID, not what is a draft.
 */

describe("creating an invitation", () => {
  let harness: Harness;
  let service: InvitationCreateService;
  let slugs: SlugService;
  let template: { templateId: string; versionId: string };

  beforeAll(async () => {
    harness = await startHarness();
    const repository = new InvitationRepository(harness.db);
    slugs = new SlugService(harness.db, repository);
    service = new InvitationCreateService(
      harness.db,
      slugs,
      new InvitationStatusService(harness.db),
      repository,
    );
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
    await harness.pool.query("DELETE FROM slug_blocklist");
    template = await createTestTemplateVersion(harness.pool);
    // The factory creates a published version; the tests that need another status say so.
    await harness.db
      .update(templateVersions)
      .set({ status: "published" })
      .where(eq(templateVersions.id, template.versionId));
  });

  const owner = async () => createTestUser(harness.pool);

  const create = async (
    scope: Awaited<ReturnType<typeof owner>>["scope"],
    over: { slug?: string; internalName?: string; templateId?: string } = {},
  ) =>
    service.create(scope, {
      templateId: over.templateId ?? template.templateId,
      internalName: over.internalName ?? "Budi & Ani",
      slug: over.slug,
    });

  describe("the aggregate (the DoD's first item)", () => {
    it("creates settings, a quote and exactly two people rows", async () => {
      const user = await owner();
      const created = await create(user.scope);

      const settings = await harness.db
        .select()
        .from(invitationSettings)
        .where(eq(invitationSettings.invitationId, created.id));
      expect(settings).toHaveLength(1);

      const quote = await harness.db
        .select()
        .from(invitationQuote)
        .where(eq(invitationQuote.invitationId, created.id));
      expect(quote).toHaveLength(1);

      const people = await harness.db
        .select()
        .from(invitationPeople)
        .where(eq(invitationPeople.invitationId, created.id));
      expect(people).toHaveLength(2);
      expect(people.map((p) => p.role).sort()).toEqual(["bride", "groom"]);
    });

    it("the people rows are empty, not absent", async () => {
      // Step 4: every later PATCH is then an UPDATE rather than an upsert with a race
      // between two tabs.
      const user = await owner();
      const created = await create(user.scope);

      const [groom] = await harness.db
        .select()
        .from(invitationPeople)
        .where(
          and(
            eq(invitationPeople.invitationId, created.id),
            eq(invitationPeople.role, "groom"),
          ),
        );
      expect(groom!.fullName).toBe("");
      expect(groom!.nickname).toBe("");
    });

    it("starts as a draft", async () => {
      const user = await owner();
      expect((await create(user.scope)).status).toBe("draft");
    });

    it("is not indexable by search engines", async () => {
      // docs/PLAN/15. An invitation carries names, addresses, times and a guest list.
      const user = await owner();
      const created = await create(user.scope);

      const [settings] = await harness.db
        .select()
        .from(invitationSettings)
        .where(eq(invitationSettings.invitationId, created.id));
      expect(settings!.seoIndexable).toBe(false);
    });

    it("enables the sections the template marks enabled_by_default", async () => {
      const user = await owner();
      const created = await create(user.scope);

      const [settings] = await harness.db
        .select()
        .from(invitationSettings)
        .where(eq(invitationSettings.invitationId, created.id));

      const [version] = await harness.db
        .select({ sections: templateVersions.sections })
        .from(templateVersions)
        .where(eq(templateVersions.id, template.versionId));

      const expected = (
        version!.sections as {
          section_key: string;
          enabled_by_default?: boolean;
        }[]
      )
        .filter((s) => s.enabled_by_default === true)
        .map((s) => s.section_key);

      // Not empty -- otherwise this passes by comparing nothing to nothing, which is how
      // the `key` vs `section_key` bug would have survived.
      expect(expected.length).toBeGreaterThan(0);

      expect([...settings!.enabledSections].sort()).toEqual(
        [...expected].sort(),
      );
    });

    it("writes the initial status-history row", async () => {
      // Step 6, through P0-14's service. An invitation whose creation has no history row
      // is one nobody can reconstruct.
      const user = await owner();
      const created = await create(user.scope);

      const history = await harness.db
        .select()
        .from(invitationStatusHistory)
        .where(eq(invitationStatusHistory.invitationId, created.id));

      expect(history).toHaveLength(1);
      expect(history[0]!.fromStatus).toBeNull();
      expect(history[0]!.toStatus).toBe("draft");
      expect(history[0]!.changedBy).toBe(user.id);
    });

    it("a failure leaves nothing behind", async () => {
      // The whole aggregate is one transaction. A partial invitation -- a row with no
      // people -- is the state every later PATCH would have to defend against.
      const user = await owner();
      await create(user.scope, { slug: "budi-dan-ani" });

      // The second attempt fails on the quota, after the slug check.
      await rejection(() => create(user.scope, { slug: "another-slug" }));

      const all = await harness.db
        .select()
        .from(invitations)
        .where(eq(invitations.ownerId, user.id));
      expect(all).toHaveLength(1);
    });
  });

  describe("the template version is locked (BR-3.1, the DoD's second item)", () => {
    it("stores a concrete version id", async () => {
      const user = await owner();
      const created = await create(user.scope);

      expect(created.templateVersionId).toBe(template.versionId);
      expect(created.templateId).toBe(template.templateId);
    });

    it("a later published version does not move an existing invitation", async () => {
      // THE reason BR-3.1 exists: an admin editing a template must not change the
      // appearance of an invitation already sent to three hundred guests.
      const user = await owner();
      const created = await create(user.scope);

      const newer = await createTestTemplateVersion(harness.pool, {
        templateId: template.templateId,
        version: "2.0.0",
      });
      await harness.db
        .update(templateVersions)
        .set({ status: "published" })
        .where(eq(templateVersions.id, newer.versionId));

      const [row] = await harness.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, created.id));

      expect(row!.templateVersionId).toBe(template.versionId);
      expect(row!.templateVersionId).not.toBe(newer.versionId);
    });

    it("a NEW invitation gets the newest published version", async () => {
      const user = await owner();
      const newer = await createTestTemplateVersion(harness.pool, {
        templateId: template.templateId,
        version: "2.0.0",
      });
      await harness.db
        .update(templateVersions)
        .set({ status: "published" })
        .where(eq(templateVersions.id, newer.versionId));

      const created = await create(user.scope);
      expect(created.templateVersionId).toBe(newer.versionId);
    });
  });

  describe("draft and deprecated versions (BR-3.3, the DoD's third item)", () => {
    it.each(["draft", "deprecated"])(
      "a %s version is refused for a new invitation",
      async (status) => {
        const user = await owner();
        await harness.db
          .update(templateVersions)
          .set({ status })
          .where(eq(templateVersions.id, template.versionId));

        const error = await rejection(() => create(user.scope));
        expect(error.status).toBe(422);
        expect(error.code).toBe("TEMPLATE_NOT_AVAILABLE");
      },
    );

    it("an unknown template is 404", async () => {
      const user = await owner();

      const error = await rejection(() =>
        create(user.scope, {
          templateId: "00000000-0000-4000-8000-0000000000ff",
        }),
      );
      expect(error.status).toBe(404);
    });
  });

  describe("slug validation (the DoD's fourth item)", () => {
    it("accepts a well-formed slug", async () => {
      const user = await owner();
      expect((await create(user.scope, { slug: "budi-dan-ani" })).slug).toBe(
        "budi-dan-ani",
      );
    });

    it("a draft may have no slug at all", async () => {
      const user = await owner();
      expect((await create(user.scope)).slug).toBeNull();
    });

    it.each([
      ["too short", "ab"],
      ["too long", "a".repeat(51)],
      ["uppercase", "Budi-Dan-Ani"],
      ["a leading dash", "-budi"],
      ["a trailing dash", "budi-"],
      ["a space", "budi dan ani"],
      ["an underscore", "budi_ani"],
      ["a dot", "budi.ani"],
      ["a slash", "budi/ani"],
      ["non-ascii", "budi-ané"],
    ])("rejects %s", async (_name, slug) => {
      const user = await owner();

      const error = await rejection(() => create(user.scope, { slug }));
      expect(error.status).toBe(400);
      expect(JSON.stringify(error)).toContain("slug");
    });

    it("rejects a reserved word", async () => {
      // docs/PLAN/10 § 2: every path segment on the public host is reserved, because
      // invitations sit at its root and an unreserved route could shadow one silently.
      await harness.db.insert(slugBlocklist).values({
        term: "admin",
        matchType: "exact",
        category: "reserved",
      });
      const user = await owner();

      const error = await rejection(() =>
        create(user.scope, { slug: "admin" }),
      );
      expect(error.status).toBe(400);
    });

    it("an exact-match term does not reject a slug that merely contains it", async () => {
      // docs/DATABASE/12 § Match Semantics, by name: "a couple named Aprilia should not
      // lose their slug to a routing concern".
      await harness.db.insert(slugBlocklist).values({
        term: "api",
        matchType: "exact",
        category: "reserved",
      });
      const user = await owner();

      await expect(
        create(user.scope, { slug: "sandi-april" }),
      ).resolves.toBeDefined();
    });

    it("a substring term rejects padding", async () => {
      await harness.db.insert(slugBlocklist).values({
        term: "badword",
        matchType: "substring",
        category: "profanity",
      });
      const user = await owner();

      const error = await rejection(() =>
        create(user.scope, { slug: "xx-badword-yy" }),
      );
      expect(error.status).toBe(400);
    });

    it("a substring term survives leetspeak", async () => {
      // docs/SECURITY/10 asks for basic folding before substring comparison.
      await harness.db.insert(slugBlocklist).values({
        term: "badword",
        matchType: "substring",
        category: "profanity",
      });
      const user = await owner();

      const error = await rejection(() =>
        create(user.scope, { slug: "b4dw0rd-wedding" }),
      );
      expect(error.status).toBe(400);
    });

    it("folding is not applied to exact reserved words", async () => {
      // `r0sa` must not fold into a reserved `rosa`. A stylised spelling is not evasion
      // when the term is a routing concern rather than profanity.
      await harness.db.insert(slugBlocklist).values({
        term: "rosa",
        matchType: "exact",
        category: "reserved",
      });
      const user = await owner();

      await expect(create(user.scope, { slug: "r0sa" })).resolves.toBeDefined();
    });

    it("leetspeak folding maps the documented characters", () => {
      expect(foldLeet("b4dw0rd")).toBe("badword");
      expect(foldLeet("l33t")).toBe("leet");
      expect(foldLeet("h1")).toBe("hi");
    });

    it("a taken slug is 409 SLUG_TAKEN, not 400", async () => {
      // Different problems for whoever is typing: one means pick another address, the
      // other means this is not a valid address at all.
      const first = await owner();
      await create(first.scope, { slug: "budi-dan-ani" });

      const second = await owner();
      const error = await rejection(() =>
        create(second.scope, { slug: "budi-dan-ani" }),
      );
      expect(error.status).toBe(409);
      expect(error.code).toBe("SLUG_TAKEN");
    });

    it("a soft-deleted invitation releases its slug", async () => {
      // ADR-033 and the partial unique index. docs/DATABASE/04 § Notes: "a slug can be
      // reused after the old invitation is truly deleted".
      const first = await owner();
      const created = await create(first.scope, { slug: "budi-dan-ani" });
      await harness.db
        .update(invitations)
        .set({ deletedAt: new Date() })
        .where(eq(invitations.id, created.id));

      const second = await owner();
      await expect(
        create(second.scope, { slug: "budi-dan-ani" }),
      ).resolves.toBeDefined();
    });

    it("the slug is lowercased before every check", async () => {
      const first = await owner();
      await create(first.scope, { slug: "budi-dan-ani" });

      // Uppercase fails the format check before it can reach uniqueness, which is the
      // correct order -- but the stored value must also never be mixed case.
      const [row] = await harness.db.select().from(invitations);
      expect(row!.slug).toBe("budi-dan-ani");
    });
  });

  describe("owner_id comes from the token (the DoD's fifth item)", () => {
    it("the service has no parameter for it", async () => {
      // docs/SECURITY/05 § 3. `create(scope, input)` -- the input type has three fields
      // and none of them is an owner. This asserts the outcome.
      const user = await owner();
      const other = await owner();

      const created = await service.create(user.scope, {
        templateId: template.templateId,
        internalName: "Budi & Ani",
        ownerId: other.id,
        owner_id: other.id,
      } as never);

      const [row] = await harness.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, created.id));
      expect(row!.ownerId).toBe(user.id);
      expect(row!.ownerId).not.toBe(other.id);
    });
  });

  describe("the free-draft quota (BR-1.4, the DoD's sixth item)", () => {
    it("allows one unpaid invitation", async () => {
      const user = await owner();
      await expect(create(user.scope)).resolves.toBeDefined();
    });

    it("refuses a second, naming the existing one", async () => {
      const user = await owner();
      const first = await create(user.scope, { internalName: "Budi & Ani" });

      const error = await rejection(() => create(user.scope));
      expect(error.status).toBe(422);
      expect(error.code).toBe("FREE_DRAFT_LIMIT_REACHED");
      expect(error.message).toContain("Budi & Ani");
      // ...and names it precisely enough to navigate to.
      expect(JSON.stringify(error)).toContain(first.id);
    });

    it("a user with a PAID invitation can still create a draft", async () => {
      // The test the DoD calls for by name. Counting drafts rather than unpaid ones
      // would cap a wedding organiser at one customer, which is what ADR-023 avoids.
      const user = await owner();
      const paid = await create(user.scope, { internalName: "Paid one" });
      await harness.pool.query(
        "UPDATE invitations SET status = 'paid' WHERE id = $1",
        [paid.id],
      );

      await expect(
        create(user.scope, { internalName: "A new draft" }),
      ).resolves.toBeDefined();
    });

    it.each(["paid", "published", "expired"])(
      "a %s invitation does not count against the quota",
      async (status) => {
        const user = await owner();
        const first = await create(user.scope);
        await harness.pool.query(
          "UPDATE invitations SET status = $2 WHERE id = $1",
          [first.id, status],
        );

        await expect(create(user.scope)).resolves.toBeDefined();
      },
    );

    it("an invitation that was paid and then unpublished still does not count", async () => {
      // Otherwise unpublishing would cost the user their ability to start a new draft --
      // and worse, the quota would be evadable in the other direction if history were
      // ignored.
      const user = await owner();
      const first = await create(user.scope);
      await harness.pool.query(
        "UPDATE invitations SET status = 'paid' WHERE id = $1",
        [first.id],
      );
      await harness.db.insert(invitationStatusHistory).values({
        invitationId: first.id,
        fromStatus: "draft",
        toStatus: "paid",
        changedBy: user.id,
        reason: "test",
      });
      await harness.pool.query(
        "UPDATE invitations SET status = 'draft' WHERE id = $1",
        [first.id],
      );

      await expect(create(user.scope)).resolves.toBeDefined();
    });

    it("a pending_payment invitation STILL counts against the quota", async () => {
      // The case that distinguishes "never paid" from "is a draft", and the reason BR-1.4
      // is worded the way it is. An invitation sitting at `pending_payment` has not been
      // paid for, so it is still unpaid inventory -- and a quota implemented as
      // `status = 'draft'` would let a user park one there and start another.
      //
      // Added because a mutation replacing the never-paid predicate with
      // `status = 'draft'` passed every other test in this block.
      const user = await owner();
      const first = await create(user.scope);
      await harness.pool.query(
        "UPDATE invitations SET status = 'pending_payment' WHERE id = $1",
        [first.id],
      );

      const error = await rejection(() => create(user.scope));
      expect(error.code).toBe("FREE_DRAFT_LIMIT_REACHED");
    });

    it("a soft-deleted draft frees the quota", async () => {
      const user = await owner();
      const first = await create(user.scope);
      await harness.db
        .update(invitations)
        .set({ deletedAt: new Date() })
        .where(eq(invitations.id, first.id));

      await expect(create(user.scope)).resolves.toBeDefined();
    });

    it("another user's draft does not count against mine", async () => {
      const a = await owner();
      const b = await owner();
      await create(a.scope);

      await expect(create(b.scope)).resolves.toBeDefined();
    });

    it("the quota is checked before anything is written", async () => {
      const user = await owner();
      await create(user.scope);

      await rejection(() => create(user.scope, { slug: "second-attempt" }));

      // No orphaned settings or people rows from the refused attempt.
      const settings = await harness.db.select().from(invitationSettings);
      expect(settings).toHaveLength(1);
    });
  });
});
