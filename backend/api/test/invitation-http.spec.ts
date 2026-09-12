import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { InvitationController } from "../src/modules/invitation/invitation.controller";
import { InvitationCreateService } from "../src/modules/invitation/invitation-create.service";
import { InvitationService } from "../src/modules/invitation/invitation.service";
import { CoupleService } from "../src/modules/invitation/couple.service";
import { NotFoundError } from "../src/http/errors";
import { SessionService } from "../src/modules/auth/session.service";
import { UnauthenticatedError } from "../src/http/errors";
import {
  POLICY_REGISTRY,
  RATE_LIMITER,
} from "../src/shared/rate-limit/rate-limit.guard";
import { PolicyRegistry } from "../src/shared/rate-limit/config";

/**
 * P1-09 at the HTTP layer.
 *
 * The point of this file is the body schema. `docs/SECURITY/05` § 3 names "`owner_id`
 * supplied in the body" as an abuse case, and the service cannot be the place that
 * defends against it — its input type has no such field, so by the time a value reached
 * the service it would already have been dropped. Whether it is *rejected* or silently
 * ignored is decided here.
 */

const created = {
  id: "33333333-3333-4333-8333-333333333333",
  slug: "budi-dan-ani",
  status: "draft",
  templateId: "44444444-4444-4444-8444-444444444444",
  templateVersionId: "55555555-5555-4555-8555-555555555555",
};

const seen: {
  input?: unknown;
  scope?: unknown;
  listOptions?: unknown;
  update?: unknown;
  deleted?: string | undefined;
  coupleRole?: string | undefined;
  coupleChanges?: unknown;
} = {};

const createStub = {
  create: async (scope: unknown, input: unknown) => {
    seen.scope = scope;
    seen.input = input;
    return created;
  },
};

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const INVITATION_ID = "33333333-3333-4333-8333-333333333333";
const OTHERS_INVITATION = "99999999-9999-4999-8999-999999999999";

const detail = {
  id: INVITATION_ID,
  owner_id: OWNER_ID,
  internal_name: "Budi & Ani",
  status: "draft",
  slug: "budi-dan-ani",
  template_id: created.templateId,
  template_version_id: created.templateVersionId,
  published_at: null,
  expiry_date: null,
  created_at: "2026-01-05T02:00:00.000Z",
  updated_at: "2026-01-05T02:00:00.000Z",
  couple: { groom: null, bride: null },
  events: [],
  gallery: [],
  bank_accounts: [],
  quote: { text: null, source: null },
  settings: {
    enabled_sections: ["hero"],
    theme_override: {},
    rsvp_enabled: true,
    guestbook_enabled: true,
    guestbook_moderation: false,
    seo_indexable: false,
  },
};

/** Anything but the owner's own invitation is a 404, as the real service would. */
const mineOr404 = (id: string) => {
  if (id !== INVITATION_ID) throw new NotFoundError();
};

const coupleStub = {
  update: async (
    _scope: unknown,
    id: string,
    role: string,
    changes: unknown,
  ) => {
    mineOr404(id);
    seen.coupleRole = role;
    seen.coupleChanges = changes;
    return {
      full_name: "Budi Santoso",
      nickname: "Budi",
      photo_media_id: null,
      instagram: null,
      father_name: null,
      mother_name: null,
      child_order: null,
    };
  },
};

const invitationStub = {
  list: async (_scope: unknown, options: unknown) => {
    seen.listOptions = options;
    return { items: [detail], total: 1 };
  },
  detail: async (_scope: unknown, id: string) => {
    mineOr404(id);
    return detail;
  },
  update: async (_scope: unknown, id: string, changes: unknown) => {
    mineOr404(id);
    seen.update = changes;
    return detail;
  },
  softDelete: async (_scope: unknown, id: string) => {
    mineOr404(id);
    seen.deleted = id;
  },
};

const sessionStub = {
  authenticate: async (header: string | undefined) => {
    if (header !== "Bearer good") throw new UnauthenticatedError();
    return {
      id: OWNER_ID,
      email: "budi@example.test",
      fullName: "Budi",
      role: "user",
      emailVerified: false,
    };
  },
};

const limiterStub = {
  check: async () => ({
    allowed: true,
    limit: 10,
    remaining: 9,
    resetAt: 1789200000,
  }),
  recordFailure: async () => {},
  block: async () => 900,
};

const AUTH = ["Authorization", "Bearer good"] as const;

const validBody = {
  template_id: created.templateId,
  internal_name: "Budi & Ani",
};

describe("POST /invitations over HTTP", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [InvitationController],
      providers: [
        { provide: APP_FILTER, useClass: AppExceptionFilter },
        { provide: InvitationCreateService, useValue: createStub },
        { provide: InvitationService, useValue: invitationStub },
        { provide: CoupleService, useValue: coupleStub },
        { provide: SessionService, useValue: sessionStub },
        { provide: RATE_LIMITER, useValue: limiterStub },
        {
          provide: POLICY_REGISTRY,
          useValue: new PolicyRegistry(undefined, undefined),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates and returns 201 with the documented fields", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/invitations")
      .set(...AUTH)
      .send(validBody)
      .expect(201);

    expect(res.body.data).toEqual({
      id: created.id,
      slug: "budi-dan-ani",
      status: "draft",
      template_id: created.templateId,
      template_version_id: created.templateVersionId,
    });
  });

  it("is 401 without a token", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/invitations")
      .send(validBody)
      .expect(401);
  });

  describe("owner_id cannot come from the body (docs/SECURITY/05 § 3)", () => {
    it.each(["owner_id", "ownerId", "user_id"])(
      "a body carrying %s is rejected",
      async (field) => {
        const res = await request(app.getHttpServer())
          .post("/api/v1/invitations")
          .set(...AUTH)
          .send({
            ...validBody,
            [field]: "22222222-2222-4222-8222-222222222222",
          })
          .expect(400);

        expect(res.body.error.code).toBe("VALIDATION_ERROR");
      },
    );

    it("the scope handed to the service is the token's user", async () => {
      seen.scope = undefined;

      await request(app.getHttpServer())
        .post("/api/v1/invitations")
        .set(...AUTH)
        .send(validBody)
        .expect(201);

      expect(seen.scope).toBe(OWNER_ID);
    });

    it("only the three documented fields reach the service", async () => {
      seen.input = undefined;

      await request(app.getHttpServer())
        .post("/api/v1/invitations")
        .set(...AUTH)
        .send({ ...validBody, slug: "budi-dan-ani" })
        .expect(201);

      expect(seen.input).toEqual({
        templateId: created.templateId,
        internalName: "Budi & Ani",
        slug: "budi-dan-ani",
      });
    });
  });

  describe("other non-writable fields", () => {
    it.each([
      ["status", { status: "published" }],
      [
        "template_version_id",
        { template_version_id: created.templateVersionId },
      ],
      ["published_at", { published_at: "2026-01-01T00:00:00Z" }],
      ["expiry_date", { expiry_date: "2027-01-01" }],
    ])("a body carrying %s is rejected", async (_name, extra) => {
      // BR-3.1 in particular: a client that could pick its own template_version_id could
      // pin an invitation to a draft or deprecated version and bypass BR-3.3 entirely.
      await request(app.getHttpServer())
        .post("/api/v1/invitations")
        .set(...AUTH)
        .send({ ...validBody, ...extra })
        .expect(400);
    });
  });

  describe("shape validation", () => {
    it.each([
      ["a missing template_id", { internal_name: "X" }],
      [
        "a non-uuid template_id",
        { template_id: "not-a-uuid", internal_name: "X" },
      ],
      ["a missing internal_name", { template_id: created.templateId }],
      ["an empty internal_name", { ...validBody, internal_name: "  " }],
      [
        "an over-long internal_name",
        { ...validBody, internal_name: "x".repeat(151) },
      ],
      ["a two-character slug", { ...validBody, slug: "ab" }],
      ["a 51-character slug", { ...validBody, slug: "a".repeat(51) }],
    ])("rejects %s", async (_name, body) => {
      await request(app.getHttpServer())
        .post("/api/v1/invitations")
        .set(...AUTH)
        .send(body)
        .expect(400);
    });

    it("an unverified user may still create a draft", async () => {
      // docs/API/01 § Registration Flow step 2: verification gates publish and checkout,
      // not drafting. The session stub above has email_verified: false.
      await request(app.getHttpServer())
        .post("/api/v1/invitations")
        .set(...AUTH)
        .send(validBody)
        .expect(201);
    });
  });

  it("is rate limited (docs/SECURITY/10, docs/PLAN/18 R7)", async () => {
    // The slug-squatting backstop. BR-1.4's quota makes it hard to reach; it stays
    // because the quota is a product rule and this is an abuse control.
    limiterStub.check = async () => ({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: 1789200000,
    });

    const res = await request(app.getHttpServer())
      .post("/api/v1/invitations")
      .set(...AUTH)
      .send(validBody)
      .expect(429);

    expect(res.body.error.code).toBe("TOO_MANY_ATTEMPTS");
  });

  describe("the other four endpoints (P1-10)", () => {
    it.each([
      ["get", `/api/v1/invitations/${INVITATION_ID}`],
      ["patch", `/api/v1/invitations/${INVITATION_ID}`],
      ["delete", `/api/v1/invitations/${INVITATION_ID}`],
      ["get", "/api/v1/invitations"],
    ])("%s %s is 401 without a token", async (method, path) => {
      await request(app.getHttpServer())
        [method as "get"](path)
        .send({ internal_name: "X" })
        .expect(401);
    });

    it.each([
      ["get", `/api/v1/invitations/${OTHERS_INVITATION}`],
      ["patch", `/api/v1/invitations/${OTHERS_INVITATION}`],
      ["delete", `/api/v1/invitations/${OTHERS_INVITATION}`],
    ])(
      "%s another user's invitation is 404 with no data",
      async (method, path) => {
        // docs/SECURITY/04 § Note: 404, never 403. A 403 would confirm the resource
        // exists and turn every :id endpoint into an enumeration oracle.
        const res = await request(app.getHttpServer())
          [method as "get"](path)
          .set(...AUTH)
          .send({ internal_name: "Hijacked" })
          .expect(404);

        expect(res.body.data).toBeUndefined();
        expect(JSON.stringify(res.body)).not.toContain("Budi & Ani");
      },
    );

    it("GET /invitations returns a paginated envelope", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/invitations?page=2&per_page=5")
        .set(...AUTH)
        .expect(200);

      expect(res.body.meta).toEqual({ page: 2, per_page: 5, total: 1 });
      expect(seen.listOptions).toMatchObject({ limit: 5, offset: 5 });
    });

    it("GET /invitations rejects an unknown status filter", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/invitations?status=nonsense")
        .set(...AUTH)
        .expect(400);
    });

    it("GET /invitations/:id returns the full aggregate", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/invitations/${INVITATION_ID}`)
        .set(...AUTH)
        .expect(200);

      expect(res.body.data.couple).toBeDefined();
      expect(res.body.data.settings.enabled_sections).toEqual(["hero"]);
    });

    it.each([
      ["status", { status: "published" }],
      ["owner_id", { owner_id: OWNER_ID }],
      ["slug", { slug: "hijacked" }],
      [
        "template_version_id",
        { template_version_id: created.templateVersionId },
      ],
      ["published_at", { published_at: "2026-01-01T00:00:00Z" }],
      ["expiry_date", { expiry_date: "2030-01-01" }],
    ])("PATCH rejects a body carrying %s", async (_name, extra) => {
      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}`)
        .set(...AUTH)
        .send({ internal_name: "X", ...extra })
        .expect(400);
    });

    it("PATCH passes only internal_name down", async () => {
      seen.update = undefined;

      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}`)
        .set(...AUTH)
        .send({ internal_name: "Budi & Ani — revisi" })
        .expect(200);

      expect(seen.update).toEqual({ internalName: "Budi & Ani — revisi" });
    });

    it("DELETE says the slug is released", async () => {
      seen.deleted = undefined;

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/invitations/${INVITATION_ID}`)
        .set(...AUTH)
        .expect(200);

      expect(seen.deleted).toBe(INVITATION_ID);
      expect(res.body.data.message).toMatch(/dapat digunakan kembali/i);
    });
  });

  describe("PATCH /invitations/:id/couple/:role (P1-11)", () => {
    it.each(["groom", "bride"])("updates the %s", async (role) => {
      seen.coupleRole = undefined;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/couple/${role}`)
        .set(...AUTH)
        .send({ full_name: "Budi Santoso", nickname: "Budi" })
        .expect(200);

      expect(seen.coupleRole).toBe(role);
      expect(res.body.data.full_name).toBe("Budi Santoso");
    });

    it.each(["spouse", "GROOM", "witness", "../groom"])(
      "an unknown role (%j) is 404, not 400",
      async (role) => {
        // `/couple/spouse` is not a route that exists. Answering 400 would imply it might.
        await request(app.getHttpServer())
          .patch(
            `/api/v1/invitations/${INVITATION_ID}/couple/${encodeURIComponent(role)}`,
          )
          .set(...AUTH)
          .send({ nickname: "X" })
          .expect(404);
      },
    );

    it("another user's invitation is 404", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${OTHERS_INVITATION}/couple/groom`)
        .set(...AUTH)
        .send({ nickname: "Hijacked" })
        .expect(404);

      expect(res.body.data).toBeUndefined();
    });

    it("is 401 without a token", async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/couple/groom`)
        .send({ nickname: "X" })
        .expect(401);
    });

    it("sanitizes every name field (P1-16)", async () => {
      // These render on a public page seen by hundreds of guests. docs/SECURITY/08 makes
      // stored XSS the primary risk here.
      seen.coupleChanges = undefined;

      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/couple/groom`)
        .set(...AUTH)
        .send({
          full_name: "<img src=x onerror=alert(1)>Budi",
          nickname: "<script>alert(1)</script>Bud",
          father_name: "<b>Pak</b> Santoso",
          mother_name: "<svg/onload=alert(1)>Ibu",
          child_order: "<iframe></iframe>Anak pertama",
        })
        .expect(200);

      expect(seen.coupleChanges).toEqual({
        fullName: "Budi",
        nickname: "Bud",
        fatherName: "Pak Santoso",
        motherName: "Ibu",
        childOrder: "Anak pertama",
      });
    });

    it.each([
      ["role", { role: "bride" }],
      ["invitation_id", { invitation_id: INVITATION_ID }],
      ["photo_url", { photo_url: "https://evil.test/x.jpg" }],
    ])("rejects a body carrying %s", async (_name, extra) => {
      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/couple/groom`)
        .set(...AUTH)
        .send({ nickname: "Budi", ...extra })
        .expect(400);
    });

    it.each([
      ["a non-uuid photo_media_id", { photo_media_id: "not-a-uuid" }],
      ["an over-long full_name", { full_name: "x".repeat(151) }],
      ["an over-long nickname", { nickname: "x".repeat(61) }],
    ])("rejects %s", async (_name, body) => {
      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/couple/groom`)
        .set(...AUTH)
        .send(body)
        .expect(400);
    });

    it("accepts null to clear an optional field", async () => {
      seen.coupleChanges = undefined;

      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/couple/groom`)
        .set(...AUTH)
        .send({ instagram: null, photo_media_id: null })
        .expect(200);

      expect(seen.coupleChanges).toEqual({
        instagram: null,
        photoMediaId: null,
      });
    });
  });
});
