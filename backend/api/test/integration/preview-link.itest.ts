import { createHash } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { Pool } from "pg";
import { Redis } from "ioredis";

import { connect, resetTenantData } from "./helpers.ts";
import { expectSuccess } from "../support/envelope-assertions";
import {
  createPhaseOneTenant,
  type PhaseOneTenant,
} from "../support/phase-one-tenant";

/**
 * `P2-12` — share-preview links, end to end. `docs/API/04` § Preview, `docs/API/08`,
 * `docs/DATABASE/04` § Share-Preview Tokens.
 *
 * `docs/DATABASE/04` states the threat in one sentence: the token *"is the only thing
 * between an unpublished invitation and the public internet"*. So most of this file is about
 * the token as a credential — what is stored, when it stops working, and whether a dead
 * token can be told apart from one that never existed.
 */

const SIGNING_KEY = "preview-link-signing-key-00000000000000000";

describe("P2-12 — share-preview links", () => {
  let owner: Pool;
  let app: INestApplication;
  let server: unknown;
  let redis: Redis;
  let alice: PhaseOneTenant;
  let mallory: PhaseOneTenant;

  const api = () => request(server as never);
  const as = (r: request.Test, who: PhaseOneTenant) =>
    r.set("Authorization", `Bearer ${who.token}`);

  const create = async (who: PhaseOneTenant = alice) => {
    const res = await as(
      api().post(`/api/v1/invitations/${who.invitation.id}/preview-link`),
      who,
    );
    return expectSuccess<{
      id: string;
      token: string;
      url: string;
      expires_at: string;
      created_at: string;
    }>(res, 201);
  };

  const resolve = (token: string) => api().get(`/public/preview/${token}`);

  beforeAll(async () => {
    owner = await connect(["invitations", "invitation_preview_tokens"]);
    await resetTenantData(owner);

    process.env["DATABASE_URL"] = (
      process.env["MIGRATION_DATABASE_URL"] ??
      "postgres://wedding_owner:wedding_owner_dev@localhost:55432/wedding"
    ).replace(/\/\/[^@]+@/, "//wedding_app:wedding_app_dev@");
    process.env["REDIS_URL"] =
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56279";
    process.env["JWT_SIGNING_KEY"] = SIGNING_KEY;
    process.env["RATE_LIMIT_OVERRIDES"] = JSON.stringify({
      "general-public": { limit: 50_000, windowSeconds: 60 },
      "general-authenticated": { limit: 50_000, windowSeconds: 60 },
    });

    // Counters AND blocks from earlier runs (`P2-07`'s lesson): an auto-block survives a
    // raised limit and turns every assertion below into a 429.
    redis = new Redis(process.env["REDIS_URL"], { maxRetriesPerRequest: 2 });
    const stale = await redis.keys("rl:*");
    if (stale.length > 0) await redis.del(...stale);

    const { AppModule } = await import("../../src/app.module.ts");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    await redis?.quit().catch(() => redis.disconnect());
  });

  beforeEach(async () => {
    await resetTenantData(owner);
    alice = await createPhaseOneTenant(owner, SIGNING_KEY, "Alice");
    mallory = await createPhaseOneTenant(owner, SIGNING_KEY, "Mallory");
    // The fixture's invitations are drafts, which is exactly what a preview is for.
  });

  // ---------------------------------------------------------------- DoD 1

  describe("the token is a credential", () => {
    it("is returned once and stored only as its hash", async () => {
      const created = await create();

      const { rows } = await owner.query<{ token_hash: string }>(
        "SELECT token_hash FROM invitation_preview_tokens WHERE id = $1",
        [created.id],
      );

      expect(rows[0]!.token_hash).not.toBe(created.token);
      expect(rows[0]!.token_hash).not.toContain(created.token);
      expect(rows[0]!.token_hash).toBe(
        createHash("sha256").update(created.token).digest("hex"),
      );
    });

    it("carries 256 bits of entropy in a URL-safe form", async () => {
      const created = await create();

      expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(created.url).toMatch(new RegExp(`/preview/${created.token}$`));
    });

    it("expires in seven days", async () => {
      const before = Date.now();
      const created = await create();
      const lifetime = Date.parse(created.expires_at) - before;

      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      expect(lifetime).toBeGreaterThan(sevenDays - 60_000);
      expect(lifetime).toBeLessThan(sevenDays + 60_000);
    });

    it("never lists a token, only ids and dates", async () => {
      const created = await create();

      const res = await as(
        api().get(`/api/v1/invitations/${alice.invitation.id}/preview-links`),
        alice,
      );
      // The tenant fixture seeds one live link of its own for the IDOR sweep.
      const links = expectSuccess<Record<string, unknown>[]>(res).filter(
        (link) => link["id"] !== alice.previewTokenId,
      );

      expect(links).toHaveLength(1);
      expect(Object.keys(links[0]!).sort()).toEqual([
        "created_at",
        "expires_at",
        "id",
        "last_accessed_at",
      ]);
      expect(JSON.stringify(res.body)).not.toContain(created.token);
    });

    it("stops working the moment it is revoked", async () => {
      const created = await create();
      expect((await resolve(created.token)).status).toBe(200);

      const revoked = await as(
        api().delete(
          `/api/v1/invitations/${alice.invitation.id}/preview-links/${created.id}`,
        ),
        alice,
      );
      expect(revoked.status).toBe(200);

      expect((await resolve(created.token)).status).toBe(404);
    });

    it("drops a revoked link from the active list", async () => {
      const created = await create();
      await as(
        api().delete(
          `/api/v1/invitations/${alice.invitation.id}/preview-links/${created.id}`,
        ),
        alice,
      );

      const res = await as(
        api().get(`/api/v1/invitations/${alice.invitation.id}/preview-links`),
        alice,
      );
      const ids = expectSuccess<{ id: string }[]>(res).map((link) => link.id);
      expect(ids).not.toContain(created.id);
      // The fixture's own link is still there, so the list is not empty for another reason.
      expect(ids).toContain(alice.previewTokenId);
    });
  });

  // ---------------------------------------------------------------- DoD 4

  describe("a dead token is indistinguishable from an invented one", () => {
    it("answers expired, revoked, invented, malformed and deleted-invitation tokens identically", async () => {
      const invented = await resolve("A".repeat(43));
      expect(invented.status).toBe(404);

      const expired = await create();
      await owner.query(
        "UPDATE invitation_preview_tokens SET expires_at = now() - interval '1 second' WHERE id = $1",
        [expired.id],
      );

      const revoked = await create();
      await owner.query(
        "UPDATE invitation_preview_tokens SET revoked_at = now() WHERE id = $1",
        [revoked.id],
      );

      const orphaned = await create(mallory);
      await owner.query(
        "UPDATE invitations SET deleted_at = now() WHERE id = $1",
        [mallory.invitation.id],
      );

      for (const [label, token] of [
        ["expired", expired.token],
        ["revoked", revoked.token],
        ["deleted invitation", orphaned.token],
        ["malformed", "not-a-token"],
        ["too long", "A".repeat(44)],
      ] as const) {
        const res = await resolve(token);
        // Status AND body. A shared status with a different message is still an oracle.
        expect(res.status, label).toBe(invented.status);
        expect(res.body, label).toEqual(invented.body);
      }
    });
  });

  // ---------------------------------------------------------------- DoD 2 and 3

  describe("what a preview serves", () => {
    it("serves an unpublished invitation, which is the point", async () => {
      const created = await create();

      const res = await resolve(created.token);
      const data = expectSuccess<{ status: string }>(res);

      // Not "published": the invitation is a draft, and the payload says what it is.
      expect(data.status).toBe("preview");
      expect(JSON.stringify(res.body)).toContain("Alice Groom");
    });

    it("is always watermarked and marked as a preview", async () => {
      const created = await create();
      const data = expectSuccess<{
        display: { watermark: boolean; preview: boolean };
      }>(await resolve(created.token));

      expect(data.display).toEqual({ watermark: true, preview: true });
    });

    it("is always noindex, whatever the invitation's own setting says", async () => {
      // An upsert, and a precondition check. The first version UPDATEd a settings row the
      // tenant fixture never creates, changed nothing, and the test passed against a payload
      // whose default was already `false` — a mutation removing the override survived it.
      await owner.query(
        `INSERT INTO invitation_settings (invitation_id, enabled_sections, seo_indexable)
         VALUES ($1, '{}', true)
         ON CONFLICT (invitation_id) DO UPDATE SET seo_indexable = true`,
        [alice.invitation.id],
      );
      const { rows } = await owner.query<{ seo_indexable: boolean }>(
        "SELECT seo_indexable FROM invitation_settings WHERE invitation_id = $1",
        [alice.invitation.id],
      );
      expect(
        rows[0]!.seo_indexable,
        "precondition: the invitation opts in",
      ).toBe(true);

      const created = await create();

      const res = await resolve(created.token);
      const data = expectSuccess<{
        invitation: { settings: { seo_indexable: boolean } };
      }>(res);

      expect(data.invitation.settings.seo_indexable).toBe(false);
      expect(res.headers["x-robots-tag"]).toContain("noindex");
    });

    it("turns RSVP and the guestbook off in the payload", async () => {
      // DoD 3: a preview must not create real guest rows. The submission routes arrive with
      // `P4`, addressed by the slug of a PUBLISHED invitation — so an unpublished
      // invitation has no submission path at all today. What this pins is the flag a future
      // page reads to decide whether to render a live form.
      await owner.query(
        `INSERT INTO invitation_settings (invitation_id, enabled_sections, rsvp_enabled, guestbook_enabled)
         VALUES ($1, '{}', true, true)
         ON CONFLICT (invitation_id) DO UPDATE SET rsvp_enabled = true, guestbook_enabled = true`,
        [alice.invitation.id],
      );
      const created = await create();

      const data = expectSuccess<{
        invitation: {
          settings: { rsvp_enabled: boolean; guestbook_enabled: boolean };
        };
      }>(await resolve(created.token));

      expect(data.invitation.settings.rsvp_enabled).toBe(false);
      expect(data.invitation.settings.guestbook_enabled).toBe(false);
    });

    it("is never cacheable by a shared cache", async () => {
      // A cached preview would keep serving somebody's draft after the owner revoked it.
      const created = await create();

      const res = await resolve(created.token);

      expect(res.headers["cache-control"]).toContain("no-store");
      expect(res.headers["cache-control"]).toContain("private");
    });

    it("records when the link was opened", async () => {
      const created = await create();
      await resolve(created.token);

      const { rows } = await owner.query<{ last_accessed_at: Date | null }>(
        "SELECT last_accessed_at FROM invitation_preview_tokens WHERE id = $1",
        [created.id],
      );
      expect(rows[0]!.last_accessed_at).not.toBeNull();
    });

    it("carries no owner or internal field", async () => {
      const created = await create();
      const serialized = JSON.stringify((await resolve(created.token)).body);

      for (const key of ["owner_id", "internal_name", "template_version_id"]) {
        expect(serialized, key).not.toContain(`"${key}"`);
      }
      expect(serialized).not.toContain(alice.user.id);
    });
  });

  // ---------------------------------------------------------------- ownership

  describe("only the owner manages links", () => {
    it("refuses to mint a link for somebody else's invitation", async () => {
      const res = await as(
        api().post(`/api/v1/invitations/${alice.invitation.id}/preview-link`),
        mallory,
      );

      expect(res.status).toBe(404);
      const { rows } = await owner.query<{ n: string }>(
        "SELECT count(*) AS n FROM invitation_preview_tokens WHERE invitation_id = $1 AND token_hash NOT LIKE 'fixture-%'",
        [alice.invitation.id],
      );
      expect(Number(rows[0]!.n)).toBe(0);
    });

    it("refuses to revoke another invitation's link through the caller's own invitation", async () => {
      const created = await create(alice);

      const res = await as(
        api().delete(
          `/api/v1/invitations/${mallory.invitation.id}/preview-links/${created.id}`,
        ),
        mallory,
      );

      expect(res.status).toBe(404);
      expect((await resolve(created.token)).status).toBe(200);
    });
  });
});
