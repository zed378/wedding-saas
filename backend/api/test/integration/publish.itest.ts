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
import { InvitationStatusService } from "../../src/shared/invitation-status/invitation-status.service";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
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
 * `P3-09` — publishing, against a real database. `MEMORY/specs/P3-09-publish.md`.
 *
 * Every refusal asserts that nothing changed as well as the answer, and every success asserts the
 * history row and the dates as well as the status.
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

describe("publish (P3-09)", () => {
  let harness: Harness;
  let service: PublishService;
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
    service = new PublishService(
      repository,
      new PublishCheckService(repository),
      new SlugService(harness.db, repository),
      new EntitlementsService(new CatalogRepository(harness.db)),
      new InvitationStatusService(harness.db),
      queue,
      { PUBLIC_INVITE_ORIGIN: "https://invitation.test" } as Env,
    );
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
    await harness.pool.query(
      "DELETE FROM slug_blocklist WHERE term = 'p309blocked'",
    );
    enqueued = [];
  });

  const verified = (user: TestUser): PublishingUser => ({
    scope: user.scope,
    emailVerified: true,
  });

  /** A complete invitation (both nicknames) with a slug, in `status`. */
  const invitation = async (
    options: { status?: string; slug?: string | null; complete?: boolean } = {},
  ) => {
    const user = await createTestUser(harness.pool);
    const template = await createTestTemplateVersion(harness.pool, {
      sections: SECTIONS,
    });
    const slug =
      options.slug === undefined
        ? `p309-${randomUUID().slice(0, 8)}`
        : options.slug;
    const { rows } = await harness.pool.query<{ id: string }>(
      `INSERT INTO invitations (owner_id, template_id, template_version_id, internal_name, slug, status)
       VALUES ($1, $2, $3, 'Test', $4, $5) RETURNING id`,
      [
        user.id,
        template.templateId,
        template.versionId,
        slug,
        options.status ?? "draft",
      ],
    );
    const id = rows[0]!.id;
    if (options.status === "paid") {
      // A real payment always writes this row (P3-05); the trial and renewal rules read it.
      await harness.pool.query(
        "INSERT INTO invitation_status_history (invitation_id, from_status, to_status, reason) VALUES ($1, 'pending_payment', 'paid', 'test: paid')",
        [id],
      );
    }
    const nickname = options.complete === false ? "" : "Budi";
    await harness.pool.query(
      `INSERT INTO invitation_people (invitation_id, role, full_name, nickname)
       VALUES ($1, 'groom', 'Budi', $2), ($1, 'bride', 'Siti', $2)`,
      [id, nickname],
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
      days: number | null;
      months: number | null;
    }>(
      `SELECT status, published_at, expiry_date::text AS expiry_date,
              (expiry_date - (now() AT TIME ZONE 'Asia/Jakarta')::date) AS days,
              (EXTRACT(YEAR FROM age(expiry_date, (now() AT TIME ZONE 'Asia/Jakarta')::date)) * 12
               + EXTRACT(MONTH FROM age(expiry_date, (now() AT TIME ZONE 'Asia/Jakarta')::date)))::int AS months
         FROM invitations WHERE id = $1`,
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
      "SELECT from_status, to_status, reason FROM invitation_status_history WHERE invitation_id = $1 ORDER BY created_at",
      [id],
    );
    return rows;
  };

  // --------------------------------------------------------------------- paid

  it("publishes a paid invitation until its package's validity ends", async () => {
    const { user, id, slug } = await invitation({ status: "paid" });
    await createTestOrder(harness.pool, {
      invitation: { id } as never,
      user,
      status: "paid",
    });

    const result = await service.publish(verified(user), id);

    const { rows: pkg } = await harness.pool.query<{ duration_months: number }>(
      "SELECT duration_months FROM packages WHERE id = 'standard'",
    );
    expect(result).toMatchObject({
      status: "published",
      slug,
      url: `https://invitation.test/${slug}`,
      trial: false,
    });
    const stored = await row(id);
    expect(stored.status).toBe("published");
    expect(stored.published_at).not.toBeNull();
    expect(stored.months).toBe(pkg[0]!.duration_months);
    expect(result.expiry_date).toBe(stored.expiry_date);
    expect((await history(id)).at(-1)).toMatchObject({
      from_status: "paid",
      to_status: "published",
      reason: "user: publish",
    });
    expect(enqueued).toEqual([
      {
        name: "notification.send",
        data: {
          template: "invitation_published",
          invitationId: id,
          trial: false,
        },
      },
    ]);
  });

  // --------------------------------------------------------------------- trial

  describe("the free trial (BR-2.8)", () => {
    it("publishes a never-paid draft once, for three days", async () => {
      const { user, id } = await invitation();

      const result = await service.publish(verified(user), id);

      expect(result.trial).toBe(true);
      const stored = await row(id);
      expect(stored.status).toBe("published");
      expect(stored.days).toBe(3);
      expect((await history(id)).at(-1)).toMatchObject({
        from_status: "draft",
        to_status: "published",
        reason: "user: free trial publish (BR-2.8)",
      });
    });

    it("refuses a second trial after the first lapsed", async () => {
      const { user, id } = await invitation();
      await service.publish(verified(user), id);
      // What `P3-13`'s sweep does when the three days pass.
      await new InvitationStatusService(harness.db).transition(id, "expired", {
        kind: "SYSTEM",
        userId: null,
      });

      const error = await rejection(() => service.publish(verified(user), id));

      expect(error).toMatchObject({ status: 422, code: "TRIAL_ALREADY_USED" });
      expect(error.message).toMatch(/pembayaran/i);
      expect((await row(id)).status).toBe("expired");
    });

    it("refuses a trial for a draft that was ever published before", async () => {
      // A refund returns an invitation to `draft` from anywhere (ADR-019); its history still shows a publish.
      const { user, id } = await invitation();
      await service.publish(verified(user), id);
      await new InvitationStatusService(harness.db).transition(
        id,
        "draft",
        { kind: "ADMIN", userId: user.id },
        "refund",
      );

      expect(
        await rejection(() => service.publish(verified(user), id)),
      ).toMatchObject({
        code: "TRIAL_ALREADY_USED",
      });
    });

    it("an expired invitation that was paid needs a renewal, not a trial", async () => {
      const { user, id } = await invitation({ status: "paid" });
      await createTestOrder(harness.pool, {
        invitation: { id } as never,
        user,
        status: "paid",
      });
      await service.publish(verified(user), id);
      await new InvitationStatusService(harness.db).transition(id, "expired", {
        kind: "SYSTEM",
        userId: null,
      });

      expect(
        await rejection(() => service.publish(verified(user), id)),
      ).toMatchObject({
        status: 422,
        code: "RENEWAL_REQUIRED",
      });
    });
  });

  // ------------------------------------------------------------------ refusals

  describe("refusals change nothing", () => {
    it("names every missing field with the publish-check's own details", async () => {
      const { user, id } = await invitation({ complete: false });
      const expected = await new PublishCheckService(
        new InvitationRepository(harness.db),
      ).check(user.scope, id);

      const error = await rejection(() => service.publish(verified(user), id));

      expect(error).toMatchObject({
        status: 422,
        code: "INCOMPLETE_INVITATION",
      });
      expect(error.details).toEqual(expected.details);
      expect(error.details).toHaveLength(2);
      expect((await row(id)).status).toBe("draft");
    });

    it.each([
      ["published", "INVITATION_ALREADY_PUBLISHED"],
      ["pending_payment", "PAYMENT_PENDING"],
    ])("a %s invitation → %s", async (status, code) => {
      const { user, id } = await invitation({ status });
      expect(
        await rejection(() => service.publish(verified(user), id)),
      ).toMatchObject({ status: 422, code });
      expect((await row(id)).status).toBe(status);
    });

    it("requires a slug", async () => {
      const { user, id } = await invitation({ slug: null });
      expect(
        await rejection(() => service.publish(verified(user), id)),
      ).toMatchObject({
        code: "SLUG_REQUIRED",
      });
    });

    it("re-checks the slug against a blocklist term added after it was chosen", async () => {
      const { user, id } = await invitation({ slug: "p309blocked" });
      await harness.pool.query(
        "INSERT INTO slug_blocklist (term, match_type, category) VALUES ('p309blocked', 'exact', 'reserved')",
      );
      expect(
        await rejection(() => service.publish(verified(user), id)),
      ).toMatchObject({
        status: 422,
        code: "SLUG_BLOCKED",
      });
      expect((await row(id)).status).toBe("draft");
    });

    it("refuses an unverified user with 403", async () => {
      const { user, id } = await invitation();
      expect(
        await rejection(() =>
          service.publish({ scope: user.scope, emailVerified: false }, id),
        ),
      ).toMatchObject({ status: 403, code: "EMAIL_NOT_VERIFIED" });
      expect((await row(id)).status).toBe("draft");
    });

    it("answers another user's invitation with 404, and publishes nothing", async () => {
      const { id } = await invitation();
      const stranger = await createTestUser(harness.pool);
      await expectServiceIdorSafe(() =>
        service.publish(verified(stranger), id),
      );
      expect((await row(id)).status).toBe("draft");
    });

    it("answers a malformed or unknown id with 404", async () => {
      const { user } = await invitation();
      for (const id of ["not-a-uuid", randomUUID()]) {
        expect(
          await rejection(() => service.publish(verified(user), id)),
        ).toMatchObject({ status: 404 });
      }
    });
  });

  it("a double click publishes once", async () => {
    const { user, id } = await invitation();

    const results = await Promise.allSettled([
      service.publish(verified(user), id),
      service.publish(verified(user), id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    )!;
    expect(rejected.reason).toMatchObject({
      code: "INVITATION_ALREADY_PUBLISHED",
    });
    expect(
      (await history(id)).filter((h) => h.to_status === "published"),
    ).toHaveLength(1);
  });
});
