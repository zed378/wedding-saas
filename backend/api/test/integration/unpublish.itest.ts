import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Env } from "../../src/config/env.schema";
import type { JobQueue } from "../../src/infra/queue/queue.module";
import { PublishCheckService } from "../../src/modules/invitation/publish-check.service";
import { SlugService } from "../../src/modules/invitation/slug.service";
import { CatalogRepository } from "../../src/modules/order/catalog.repository";
import { EntitlementsService } from "../../src/modules/order/entitlements.service";
import {
  PublishService,
  type PublishingUser,
} from "../../src/modules/publishing/publish.service";
import { UnpublishService } from "../../src/modules/publishing/unpublish.service";
import { InvitationStatusService } from "../../src/shared/invitation-status/invitation-status.service";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import { PublicInvitationRepository } from "../../src/shared/tenancy/public-invitation-repository";
import {
  createTestOrder,
  createTestTemplateVersion,
  createTestUser,
  type TestUser,
} from "../support/factories";
import { startHarness, type Harness } from "../support/harness";
import { expectServiceIdorSafe } from "../support/idor";
import { rejection } from "../support/rejection";
import { resetTenantData } from "./helpers.ts";

/**
 * `P3-10` — unpublish and republish, against a real database. `MEMORY/specs/P3-10-unpublish-republish.md`,
 * ADR-081.
 *
 * The theme: **taking an invitation offline and putting it back must be free and must not be profitable.**
 * Free — a paid invitation returns to `paid`, not to a checkout. Not profitable — a trial does not become
 * `paid`, and no republish adds a day of validity nobody bought.
 */

const SECTIONS = [
  {
    section_key: "hero",
    component: "HeroClassic",
    enabled_by_default: true,
    configurable: false,
    required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
  },
];

describe("unpublish and republish (P3-10)", () => {
  let harness: Harness;
  let publishing: PublishService;
  let unpublishing: UnpublishService;
  let slugs: SlugService;
  let publicRead: PublicInvitationRepository;
  let status: InvitationStatusService;
  let enqueued: { name: string; data: Record<string, unknown> }[];

  const queue: JobQueue = {
    enqueue: async (_pool, name, data) => {
      enqueued.push({ name, data });
    },
    close: async () => {},
  };

  beforeAll(async () => {
    harness = await startHarness();
    const repository = new InvitationRepository(harness.db);
    status = new InvitationStatusService(harness.db);
    slugs = new SlugService(harness.db, repository);
    publicRead = new PublicInvitationRepository(harness.db);
    publishing = new PublishService(
      repository,
      new PublishCheckService(repository),
      slugs,
      new EntitlementsService(new CatalogRepository(harness.db)),
      status,
      queue,
      { PUBLIC_INVITE_ORIGIN: "https://invitation.test" } as Env,
    );
    unpublishing = new UnpublishService(repository, status, queue);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
    enqueued = [];
  });

  const verified = (user: TestUser): PublishingUser => ({
    scope: user.scope,
    emailVerified: true,
  });

  /** A complete invitation with a slug; `paid` carries the history row and a paid order a payment writes. */
  const invitation = async (options: { paid?: boolean } = {}) => {
    const user = await createTestUser(harness.pool);
    const template = await createTestTemplateVersion(harness.pool, {
      sections: SECTIONS,
    });
    const slug = `p310-${randomUUID().slice(0, 8)}`;
    const { rows } = await harness.pool.query<{ id: string }>(
      `INSERT INTO invitations (owner_id, template_id, template_version_id, internal_name, slug, status)
       VALUES ($1, $2, $3, 'Test', $4, $5) RETURNING id`,
      [
        user.id,
        template.templateId,
        template.versionId,
        slug,
        options.paid === true ? "paid" : "draft",
      ],
    );
    const id = rows[0]!.id;
    if (options.paid === true) {
      await harness.pool.query(
        "INSERT INTO invitation_status_history (invitation_id, from_status, to_status, reason) VALUES ($1, 'pending_payment', 'paid', 'test: paid')",
        [id],
      );
      await createTestOrder(harness.pool, {
        invitation: { id } as never,
        user,
        status: "paid",
        createdAt: new Date(Date.now() - 60_000),
      });
    }
    await harness.pool.query(
      `INSERT INTO invitation_people (invitation_id, role, full_name, nickname)
       VALUES ($1, 'groom', 'Budi', 'Budi'), ($1, 'bride', 'Siti', 'Siti')`,
      [id],
    );
    await harness.pool.query(
      "INSERT INTO invitation_settings (invitation_id, enabled_sections) VALUES ($1, $2)",
      [id, ["hero"]],
    );
    return { user, id, slug };
  };

  const row = async (id: string) => {
    const { rows } = await harness.pool.query<{
      status: string;
      published_at: Date | null;
      expiry_date: string | null;
    }>(
      "SELECT status, published_at, expiry_date::text AS expiry_date FROM invitations WHERE id = $1",
      [id],
    );
    return rows[0]!;
  };

  const history = async (id: string) => {
    const { rows } = await harness.pool.query<{
      from_status: string | null;
      to_status: string;
      reason: string;
    }>(
      "SELECT from_status, to_status, reason FROM invitation_status_history WHERE invitation_id = $1 ORDER BY created_at, id",
      [id],
    );
    return rows;
  };

  /** Moves the stored expiry to a different day, as if time had passed. */
  const setExpiry = async (id: string, daysFromToday: number) => {
    await harness.pool.query(
      "UPDATE invitations SET expiry_date = (now() AT TIME ZONE 'Asia/Jakarta')::date + $2::int WHERE id = $1",
      [id, daysFromToday],
    );
  };

  // ------------------------------------------------------------------ unpublish

  describe("unpublish", () => {
    it("returns a paid invitation to paid, keeps its dates, and queues the cache invalidation", async () => {
      const { user, id, slug } = await invitation({ paid: true });
      await publishing.publish(verified(user), id);
      const before = await row(id);
      enqueued = [];

      const result = await unpublishing.unpublish(user.scope, id);

      expect(result).toEqual({ status: "paid", slug });
      const after = await row(id);
      expect(after.status).toBe("paid");
      expect(after.published_at).toEqual(before.published_at);
      expect(after.expiry_date).toBe(before.expiry_date);
      expect((await history(id)).at(-1)).toMatchObject({
        from_status: "published",
        to_status: "paid",
        reason: "user: unpublish",
      });
      expect(enqueued).toEqual([
        {
          name: "cache.invalidate",
          data: { slug, invitationId: id, reason: "unpublished" },
        },
      ]);
    });

    it("unpublishes a trial to draft, never to paid", async () => {
      const { user, id } = await invitation();
      await publishing.publish(verified(user), id);

      const result = await unpublishing.unpublish(user.scope, id);

      expect(result.status).toBe("draft");
      expect((await row(id)).status).toBe("draft");
      expect((await history(id)).some((h) => h.to_status === "paid")).toBe(
        false,
      );
      expect((await history(id)).at(-1)).toMatchObject({
        from_status: "published",
        to_status: "draft",
        reason: "user: unpublish a free trial",
      });
    });

    it("takes the public page down on the next read", async () => {
      const { user, id, slug } = await invitation({ paid: true });
      await publishing.publish(verified(user), id);
      expect(await publicRead.findPublishedBySlug(slug)).not.toBeNull();

      await unpublishing.unpublish(user.scope, id);

      expect(await publicRead.findPublishedBySlug(slug)).toBeNull();
    });

    it("keeps the slug reserved while unpublished", async () => {
      const { user, id, slug } = await invitation({ paid: true });
      await publishing.publish(verified(user), id);
      await unpublishing.unpublish(user.scope, id);

      const other = await invitation();
      expect(await slugs.check(slug, other.id)).toMatchObject({
        kind: "taken",
      });
      const { rowCount } = await harness.pool
        .query("UPDATE invitations SET slug = $1 WHERE id = $2", [
          slug,
          other.id,
        ])
        .catch((error: { code?: string }) => {
          expect(error.code).toBe("23505");
          return { rowCount: 0 };
        });
      expect(rowCount).toBe(0);
    });

    it.each(["draft", "paid"])(
      "refuses a %s invitation with INVITATION_NOT_PUBLISHED and changes nothing",
      async (kind) => {
        const { user, id } = await invitation({ paid: kind === "paid" });
        const before = await history(id);

        expect(
          await rejection(() => unpublishing.unpublish(user.scope, id)),
        ).toMatchObject({ status: 422, code: "INVITATION_NOT_PUBLISHED" });
        expect((await row(id)).status).toBe(kind);
        expect(await history(id)).toEqual(before);
        expect(enqueued).toEqual([]);
      },
    );

    it("a double unpublish succeeds once", async () => {
      const { user, id } = await invitation({ paid: true });
      await publishing.publish(verified(user), id);

      const results = await Promise.allSettled([
        unpublishing.unpublish(user.scope, id),
        unpublishing.unpublish(user.scope, id),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      )!;
      expect(rejected.reason).toMatchObject({
        code: "INVITATION_NOT_PUBLISHED",
      });
      expect(
        (await history(id)).filter((h) => h.from_status === "published"),
      ).toHaveLength(1);
    });

    it("answers another user's invitation with 404, and unpublishes nothing", async () => {
      const { user, id } = await invitation({ paid: true });
      await publishing.publish(verified(user), id);
      const stranger = await createTestUser(harness.pool);

      await expectServiceIdorSafe(() =>
        unpublishing.unpublish(stranger.scope, id),
      );
      expect((await row(id)).status).toBe("published");
      expect(enqueued.filter((j) => j.name === "cache.invalidate")).toEqual([]);
    });

    it("answers a malformed or unknown id with 404", async () => {
      const { user } = await invitation();
      for (const id of ["not-a-uuid", randomUUID()]) {
        expect(
          await rejection(() => unpublishing.unpublish(user.scope, id)),
        ).toMatchObject({ status: 404 });
      }
    });
  });

  // ------------------------------------------------------------------ republish

  describe("republish never adds validity (ADR-081)", () => {
    it("republishing keeps the expiry date it had", async () => {
      const { user, id } = await invitation({ paid: true });
      await publishing.publish(verified(user), id);
      // Pretend the first publish was months ago: a fresh 12 months would move this date.
      await setExpiry(id, 30);
      const before = await row(id);
      await unpublishing.unpublish(user.scope, id);

      const result = await publishing.publish(verified(user), id);

      const after = await row(id);
      expect(after.status).toBe("published");
      expect(after.expiry_date).toBe(before.expiry_date);
      expect(result.expiry_date).toBe(before.expiry_date);
      expect(after.published_at).toEqual(before.published_at);
      expect(result.trial).toBe(false);
    });

    it("a paid republish after the validity ran out needs a renewal", async () => {
      const { user, id } = await invitation({ paid: true });
      await publishing.publish(verified(user), id);
      await unpublishing.unpublish(user.scope, id);
      await setExpiry(id, -1);

      expect(
        await rejection(() => publishing.publish(verified(user), id)),
      ).toMatchObject({ status: 422, code: "RENEWAL_REQUIRED" });
      expect((await row(id)).status).toBe("paid");
    });

    it("a fresh purchase after a refund gets a new expiry", async () => {
      const { user, id } = await invitation({ paid: true });
      await publishing.publish(verified(user), id);
      await setExpiry(id, 30);
      // Refund (ADR-019), then pay again: a newer paid order than the last publish.
      await status.transition(
        id,
        "draft",
        { kind: "ADMIN", userId: user.id },
        "refund",
      );
      await harness.pool.query(
        "UPDATE orders SET status = 'refunded' WHERE invitation_id = $1",
        [id],
      );
      await status.transition(id, "pending_payment", {
        kind: "USER",
        userId: user.scope,
      });
      await status.transition(id, "paid", { kind: "SYSTEM", userId: null });
      await createTestOrder(harness.pool, {
        invitation: { id } as never,
        user,
        status: "paid",
      });

      await publishing.publish(verified(user), id);

      const { rows } = await harness.pool.query<{ months: number }>(
        `SELECT (EXTRACT(YEAR FROM age(expiry_date, (now() AT TIME ZONE 'Asia/Jakarta')::date)) * 12
                 + EXTRACT(MONTH FROM age(expiry_date, (now() AT TIME ZONE 'Asia/Jakarta')::date)))::int AS months
           FROM invitations WHERE id = $1`,
        [id],
      );
      const { rows: pkg } = await harness.pool.query<{
        duration_months: number;
      }>("SELECT duration_months FROM packages WHERE id = 'standard'");
      expect(rows[0]!.months).toBe(pkg[0]!.duration_months);
    });

    it("resumes a trial inside its window without extending it", async () => {
      const { user, id } = await invitation();
      await publishing.publish(verified(user), id);
      await setExpiry(id, 1);
      const before = await row(id);
      await unpublishing.unpublish(user.scope, id);

      const result = await publishing.publish(verified(user), id);

      expect(result.trial).toBe(true);
      const after = await row(id);
      expect(after.status).toBe("published");
      expect(after.expiry_date).toBe(before.expiry_date);
      expect(after.published_at).toEqual(before.published_at);
    });

    it("refuses to resume a trial after its window", async () => {
      const { user, id } = await invitation();
      await publishing.publish(verified(user), id);
      await unpublishing.unpublish(user.scope, id);
      await setExpiry(id, -1);

      expect(
        await rejection(() => publishing.publish(verified(user), id)),
      ).toMatchObject({ status: 422, code: "TRIAL_ALREADY_USED" });
      expect((await row(id)).status).toBe("draft");
    });
  });
});
