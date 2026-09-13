import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { Pool } from "pg";

import { connect, resetTenantData } from "./helpers.ts";
import { expectSuccess } from "../support/envelope-assertions";
import {
  createPhaseOneTenant,
  type PhaseOneTenant,
} from "../support/phase-one-tenant";
import { startHarness, type Harness } from "../support/harness";
import {
  createTestTemplateVersion,
  createTestUser,
} from "../support/factories";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import { PublishCheckService } from "../../src/modules/invitation/publish-check.service";
import { expectIdorSafe } from "../support/idor";

/**
 * P2-06 — the publish check. BR-4.2.
 *
 * The card's first DoD item is the one worth the most care: *"a required field inside a
 * disabled section does not block publishing; a test covers exactly this."* Getting it
 * backwards refuses to publish an invitation that is exactly as the user wants it.
 */

const SECTIONS = [
  {
    section_key: "hero",
    component: "HeroClassic",
    enabled_by_default: true,
    configurable: false,
    required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
  },
  {
    section_key: "gift",
    component: "GiftAccountList",
    enabled_by_default: true,
    configurable: true,
    required_fields: ["gift.accounts.*.account_number"],
  },
];

describe("P2-06 — publish check", () => {
  let harness: Harness;
  let owner: Pool;
  let service: PublishCheckService;
  let repository: InvitationRepository;

  beforeAll(async () => {
    harness = await startHarness();
    owner = await connect(["invitations", "template_versions"]);
    repository = new InvitationRepository(harness.db);
    service = new PublishCheckService(repository);
  }, 60_000);

  afterAll(async () => {
    await owner?.end();
    await harness?.stop();
  });

  beforeEach(async () => {
    await resetTenantData(owner);
  });

  /** An invitation on a template with the sections above, and nothing filled in. */
  const seed = async (options: { enabled?: string[] } = {}) => {
    const user = await createTestUser(owner, { fullName: "Alice" });
    const template = await createTestTemplateVersion(owner, {
      sections: SECTIONS,
    });

    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO invitations (owner_id, template_id, template_version_id, internal_name)
       VALUES ($1, $2, $3, 'Test') RETURNING id`,
      [user.id, template.templateId, template.versionId],
    );
    const invitationId = rows[0]!.id;

    await owner.query(
      `INSERT INTO invitation_people (invitation_id, role, full_name, nickname)
       VALUES ($1, 'groom', '', ''), ($1, 'bride', '', '')`,
      [invitationId],
    );
    await owner.query(
      `INSERT INTO invitation_settings (invitation_id, enabled_sections)
       VALUES ($1, $2)`,
      [invitationId, options.enabled ?? ["hero", "gift"]],
    );

    return { user, invitationId };
  };

  const fillCouple = (invitationId: string) =>
    owner
      .query(
        `UPDATE invitation_people SET nickname = 'Budi' WHERE invitation_id = $1 AND role = 'groom'`,
        [invitationId],
      )
      .then(() =>
        owner.query(
          `UPDATE invitation_people SET nickname = 'Siti' WHERE invitation_id = $1 AND role = 'bride'`,
          [invitationId],
        ),
      );

  describe("DoD 1 — a disabled section does not block", () => {
    it("reports the gift account as missing while the gift section is on", async () => {
      const { user, invitationId } = await seed();
      await fillCouple(invitationId);

      const result = await service.check(user.scope, invitationId);

      expect(result.ready).toBe(false);
      expect(result.incomplete_sections).toEqual(["gift"]);
    });

    it("is ready once the gift section is turned off", async () => {
      // Exactly the DoD case. The couple has no account number and is NOT incomplete:
      // they made a choice, and refusing to publish would be refusing the invitation they
      // asked for.
      const { user, invitationId } = await seed({ enabled: ["hero"] });
      await fillCouple(invitationId);

      const result = await service.check(user.scope, invitationId);

      expect(result.ready).toBe(true);
      expect(result.details).toEqual([]);
    });

    it("still blocks on a NON-configurable section the settings omit", async () => {
      // `hero` is `configurable: false`, so it is displayed whatever the settings say —
      // and its required fields therefore still apply. A settings row that omits it must
      // not become a way to publish an invitation with no names on it.
      const { user, invitationId } = await seed({ enabled: [] });

      const result = await service.check(user.scope, invitationId);

      expect(result.ready).toBe(false);
      expect(result.incomplete_sections).toContain("hero");
    });
  });

  describe("DoD 4 — no path reaches the interface untranslated", () => {
    it("describes each missing field in Indonesian, with its section", async () => {
      const { user, invitationId } = await seed({ enabled: ["hero"] });

      const result = await service.check(user.scope, invitationId);
      const messages = result.details.map((d) => d.message);

      expect(messages).toContain(
        "Nama panggilan mempelai pria di bagian Sampul",
      );
      expect(messages).toContain(
        "Nama panggilan mempelai wanita di bagian Sampul",
      );
      for (const message of messages) {
        expect(message).not.toContain("couple.");
      }
    });

    it("keeps the canonical path in `field`, for a client that wants to focus it", async () => {
      const { user, invitationId } = await seed({ enabled: ["hero"] });

      const result = await service.check(user.scope, invitationId);

      expect(result.details.map((d) => d.field)).toContain(
        "couple.groom.nickname",
      );
    });
  });

  describe("DoD 2 — the shape the publish 422 uses", () => {
    it("returns details as { field, message } and nothing else", async () => {
      const { user, invitationId } = await seed({ enabled: ["hero"] });

      const result = await service.check(user.scope, invitationId);

      for (const detail of result.details) {
        expect(Object.keys(detail).sort()).toEqual(["field", "message"]);
      }
    });

    it("reports ready with an empty list once everything is filled", async () => {
      const { user, invitationId } = await seed({ enabled: ["hero"] });
      await fillCouple(invitationId);

      expect(await service.check(user.scope, invitationId)).toEqual({
        ready: true,
        details: [],
        incomplete_sections: [],
      });
    });
  });

  describe("ownership", () => {
    it("answers a non-owner with 404 and the owner with a result", async () => {
      await expectIdorSafe(owner, (invitationId, scope) =>
        service.check(scope, invitationId).catch((error: unknown) => {
          if ((error as { status?: number }).status === 404) throw error;
          return null;
        }),
      );
    });
  });
});

/**
 * The same endpoint over HTTP, against the real application.
 *
 * Global DoD item 6 says the envelope is *asserted* in an integration test rather than
 * assumed, and a service-level suite cannot see it: `ok()` is applied by the controller,
 * and a route that forgot it would pass every test above.
 */
describe("P2-06 — GET /invitations/:id/publish-check over HTTP", () => {
  let owner: Pool;
  let app: INestApplication;
  let server: unknown;
  let alice: PhaseOneTenant;
  const signingKey = "publish-check-http-signing-key-00000000000";

  beforeAll(async () => {
    owner = await connect(["invitations", "template_versions"]);
    await resetTenantData(owner);

    process.env["DATABASE_URL"] = (
      process.env["MIGRATION_DATABASE_URL"] ??
      "postgres://wedding_owner:wedding_owner_dev@localhost:55432/wedding"
    ).replace(/\/\/[^@]+@/, "//wedding_app:wedding_app_dev@");
    process.env["REDIS_URL"] =
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279";
    process.env["JWT_SIGNING_KEY"] = signingKey;

    const { AppModule } = await import("../../src/app.module.ts");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();

    alice = await createPhaseOneTenant(owner, signingKey, "Alice");
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await owner?.end();
  });

  it("answers inside the `docs/API/00` envelope and nothing else", async () => {
    const res = await request(server as never)
      .get(`/api/v1/invitations/${alice.invitation.id}/publish-check`)
      .set("Authorization", `Bearer ${alice.token}`);

    const data = expectSuccess<{
      ready: boolean;
      details: { field: string; message: string }[];
      incomplete_sections: string[];
    }>(res);

    expect(Object.keys(data).sort()).toEqual([
      "details",
      "incomplete_sections",
      "ready",
    ]);
    expect(typeof data.ready).toBe("boolean");
    expect(Array.isArray(data.details)).toBe(true);
    expect(Array.isArray(data.incomplete_sections)).toBe(true);

    // Whatever is missing, the user is told in words. The service test proves the labels;
    // this proves nothing between the service and the wire replaced them with paths.
    for (const detail of data.details) {
      expect(Object.keys(detail).sort()).toEqual(["field", "message"]);
      expect(detail.message).not.toContain(detail.field);
    }
  });

  it("gives a stranger a 404 with no trace of the invitation", async () => {
    const mallory = await createPhaseOneTenant(owner, signingKey, "Mallory");

    const res = await request(server as never)
      .get(`/api/v1/invitations/${alice.invitation.id}/publish-check`)
      .set("Authorization", `Bearer ${mallory.token}`);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(alice.invitation.id);
  });
});
