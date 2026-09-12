import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { InvitationController } from "../src/modules/invitation/invitation.controller";
import { InvitationCreateService } from "../src/modules/invitation/invitation-create.service";
import { InvitationService } from "../src/modules/invitation/invitation.service";
import { CoupleService } from "../src/modules/invitation/couple.service";
import { EventsService } from "../src/modules/invitation/events.service";
import {
  GiftService,
  QuoteService,
} from "../src/modules/invitation/gift.service";
import { SettingsService } from "../src/modules/invitation/settings.service";
import { ChangeTemplateService } from "../src/modules/invitation/change-template.service";
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
  eventInput?: unknown;
  eventId?: string | undefined;
  giftInput?: unknown;
  bankId?: string | undefined;
  quoteInput?: unknown;
  settingsPatch?: unknown;
  changeTemplateId?: string | undefined;
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

const eventDto = {
  id: "77777777-7777-4777-8777-777777777777",
  type: "akad",
  title: "Akad Nikah",
  event_date: "2027-06-12",
  start_time: "08:00",
  end_time: null,
  venue_name: "Masjid Agung",
  address: "Jl. Merdeka No. 1",
  latitude: null,
  longitude: null,
  description: null,
  display_order: 0,
};

const bankDto = {
  id: "88888888-8888-4888-8888-888888888888",
  type: "bank",
  provider_name: "BCA",
  account_number: "1234567890",
  account_holder: "Budi Santoso",
  display_order: 0,
};

const giftStub = {
  list: async (_scope: unknown, id: string) => {
    mineOr404(id);
    return [bankDto];
  },
  create: async (_scope: unknown, id: string, input: unknown) => {
    mineOr404(id);
    seen.giftInput = input;
    return bankDto;
  },
  update: async (
    _scope: unknown,
    id: string,
    bankId: string,
    changes: unknown,
  ) => {
    mineOr404(id);
    seen.giftInput = changes;
    seen.bankId = bankId;
    return bankDto;
  },
  remove: async (_scope: unknown, id: string) => {
    mineOr404(id);
  },
};

const NEW_TEMPLATE_ID = "66666666-6666-4666-8666-666666666666";

const changeTemplateStub = {
  change: async (_scope: unknown, id: string, templateId: string) => {
    mineOr404(id);
    seen.changeTemplateId = templateId;
    return {
      template_id: templateId,
      template_version_id: "88888888-8888-4888-8888-888888888888",
      enabled_sections: ["hero", "quote"],
      hidden_sections: ["gallery"],
      dropped_theme_keys: ["colors.accent"],
    };
  },
};

const settingsStub = {
  get: async (_scope: unknown, id: string) => {
    mineOr404(id);
    return { ...detail.settings, slug: "budi-dan-ani" };
  },
  update: async (_scope: unknown, id: string, patch: unknown) => {
    mineOr404(id);
    seen.settingsPatch = patch;
    return { ...detail.settings, slug: "budi-dan-ani" };
  },
};

const quoteStub = {
  get: async (_scope: unknown, id: string) => {
    mineOr404(id);
    return { text: null, source: null };
  },
  update: async (_scope: unknown, id: string, changes: unknown) => {
    mineOr404(id);
    seen.quoteInput = changes;
    return { text: "A quote", source: null };
  },
};

const eventsStub = {
  list: async (_scope: unknown, id: string) => {
    mineOr404(id);
    return [eventDto];
  },
  create: async (_scope: unknown, id: string, input: unknown) => {
    mineOr404(id);
    seen.eventInput = input;
    return eventDto;
  },
  update: async (
    _scope: unknown,
    id: string,
    eventId: string,
    changes: unknown,
  ) => {
    mineOr404(id);
    seen.eventInput = changes;
    seen.eventId = eventId;
    return eventDto;
  },
  remove: async (_scope: unknown, id: string) => {
    mineOr404(id);
  },
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

/** Permissive by default; a test that refuses restores it through `beforeEach`. */
const ALLOW = {
  allowed: true as boolean,
  limit: 10,
  remaining: 9,
  resetAt: 1789200000,
};

const limiterStub = {
  check: async () =>
    ALLOW as {
      allowed: boolean;
      limit: number;
      remaining: number;
      resetAt: number;
      retryAfterSeconds?: number;
    },
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
        { provide: EventsService, useValue: eventsStub },
        { provide: GiftService, useValue: giftStub },
        { provide: QuoteService, useValue: quoteStub },
        { provide: SettingsService, useValue: settingsStub },
        { provide: ChangeTemplateService, useValue: changeTemplateStub },
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

  beforeEach(() => {
    // The limiter stub is shared, and a test that makes it refuse used to leave it that
    // way -- which broke every later test in the file with a 429 that had nothing to do
    // with what it was checking. Resetting here rather than in each test means the next
    // person to add a refusing case cannot reintroduce it.
    limiterStub.check = async () => ALLOW;
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

  describe("events endpoints (P1-12)", () => {
    const EVENT_BODY = {
      type: "akad",
      title: "Akad Nikah",
      event_date: "2027-06-12",
      start_time: "08:00",
      venue_name: "Masjid Agung",
      address: "Jl. Merdeka No. 1",
    };

    it("lists, creates, updates and deletes", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/invitations/${INVITATION_ID}/events`)
        .set(...AUTH)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/events`)
        .set(...AUTH)
        .send(EVENT_BODY)
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/events/${eventDto.id}`)
        .set(...AUTH)
        .send({ title: "Renamed" })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/v1/invitations/${INVITATION_ID}/events/${eventDto.id}`)
        .set(...AUTH)
        .expect(200);
    });

    it.each([
      ["get", `/api/v1/invitations/${OTHERS_INVITATION}/events`],
      ["post", `/api/v1/invitations/${OTHERS_INVITATION}/events`],
    ])("%s on another user's invitation is 404", async (method, path) => {
      const res = await request(app.getHttpServer())
        [method as "get"](path)
        .set(...AUTH)
        .send(EVENT_BODY)
        .expect(404);

      expect(res.body.data).toBeUndefined();
    });

    it.each([
      ["an unknown type", { type: "engagement" }],
      ["a missing title", { title: undefined }],
      ["a bad date", { event_date: "12-06-2027" }],
      ["a bad start_time", { start_time: "8am" }],
      ["a 24-hour start_time", { start_time: "24:00" }],
      ["an out-of-range latitude", { latitude: 91 }],
      ["an out-of-range longitude", { longitude: -181 }],
      ["an over-long title", { title: "x".repeat(151) }],
      ["an over-long address", { address: "x".repeat(2001) }],
    ])("rejects %s", async (_name, extra) => {
      // The coordinate ranges are the card's third DoD item. A latitude of 91 is not a
      // place, and without the check it would render as a pin somewhere undefined.
      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/events`)
        .set(...AUTH)
        .send({ ...EVENT_BODY, ...extra })
        .expect(400);
    });

    it.each([
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "//evil.test/x",
    ])("rejects a maps_url scheme of %j", async (maps_url) => {
      // `z.url()` alone accepts the first three -- measured. maps_url becomes an href on
      // the public page, so the schema requires ^https?:// before parsing.
      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/events`)
        .set(...AUTH)
        .send({ ...EVENT_BODY, maps_url })
        .expect(400);
    });

    it.each(["https://maps.app.goo.gl/x", "http://maps.example.test/x"])(
      "accepts a maps_url of %j",
      async (maps_url) => {
        await request(app.getHttpServer())
          .post(`/api/v1/invitations/${INVITATION_ID}/events`)
          .set(...AUTH)
          .send({ ...EVENT_BODY, maps_url })
          .expect(201);
      },
    );

    it("sanitizes title, venue_name, address and description", async () => {
      seen.eventInput = undefined;

      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/events`)
        .set(...AUTH)
        .send({
          ...EVENT_BODY,
          title: "<script>alert(1)</script>Akad",
          venue_name: "<img src=x onerror=alert(1)>Masjid",
          address: "<b>Jl.</b> Merdeka",
          description: "<svg/onload=alert(1)>Mohon hadir",
        })
        .expect(201);

      expect(seen.eventInput).toMatchObject({
        title: "Akad",
        venueName: "Masjid",
        address: "Jl. Merdeka",
        description: "Mohon hadir",
      });
    });

    it("rejects a body carrying invitation_id or id", async () => {
      for (const extra of [{ invitation_id: INVITATION_ID }, { id: "x" }]) {
        await request(app.getHttpServer())
          .post(`/api/v1/invitations/${INVITATION_ID}/events`)
          .set(...AUTH)
          .send({ ...EVENT_BODY, ...extra })
          .expect(400);
      }
    });

    it("is 401 without a token", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/invitations/${INVITATION_ID}/events`)
        .expect(401);
    });
  });

  describe("gift accounts (P1-13)", () => {
    const BANK_BODY = {
      type: "bank",
      provider_name: "BCA",
      account_number: "1234567890",
      account_holder: "Budi Santoso",
    };

    it("lists, creates, updates and deletes", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/invitations/${INVITATION_ID}/bank-accounts`)
        .set(...AUTH)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/bank-accounts`)
        .set(...AUTH)
        .send(BANK_BODY)
        .expect(201);

      await request(app.getHttpServer())
        .patch(
          `/api/v1/invitations/${INVITATION_ID}/bank-accounts/${bankDto.id}`,
        )
        .set(...AUTH)
        .send({ account_holder: "Budi S." })
        .expect(200);

      await request(app.getHttpServer())
        .delete(
          `/api/v1/invitations/${INVITATION_ID}/bank-accounts/${bankDto.id}`,
        )
        .set(...AUTH)
        .expect(200);
    });

    it.each([
      ["get", `/api/v1/invitations/${OTHERS_INVITATION}/bank-accounts`],
      ["post", `/api/v1/invitations/${OTHERS_INVITATION}/bank-accounts`],
    ])("%s on another user's invitation is 404", async (method, path) => {
      const res = await request(app.getHttpServer())
        [method as "get"](path)
        .set(...AUTH)
        .send(BANK_BODY)
        .expect(404);

      expect(res.body.data).toBeUndefined();
    });

    it.each([
      ["letters", "12ab567890"],
      ["a script tag", "<script>alert(1)</script>"],
      ["a trailing dash", "123456789-"],
      ["too short", "12"],
      ["an empty string", ""],
      ["a plus sign", "+6281234567890"],
    ])(
      "rejects an account_number containing %s",
      async (_name, account_number) => {
        // The format check P1-16's exemption promised. `account_number` is NOT sanitized as
        // prose -- tag stripping would silently alter a value whose exact characters matter
        // -- so a character allowlist is what makes markup impossible here.
        await request(app.getHttpServer())
          .post(`/api/v1/invitations/${INVITATION_ID}/bank-accounts`)
          .set(...AUTH)
          .send({ ...BANK_BODY, account_number })
          .expect(400);
      },
    );

    it.each([
      "1234567890",
      "1234 5678 90",
      "1234-5678-90",
      // Trimmed, not rejected. Somebody pasting from their banking app brings whitespace
      // with them, and refusing that would be a worse product for no security gain -- the
      // character allowlist still applies to what is left.
      " 1234567890 ",
    ])("accepts an account_number of %j", async (account_number) => {
      // Real Indonesian account numbers are written with spaces and hyphens.
      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/bank-accounts`)
        .set(...AUTH)
        .send({ ...BANK_BODY, account_number })
        .expect(201);
    });

    it("rejects an unknown type", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/bank-accounts`)
        .set(...AUTH)
        .send({ ...BANK_BODY, type: "crypto" })
        .expect(400);
    });

    it("sanitizes provider_name and account_holder but NOT the number", async () => {
      seen.giftInput = undefined;

      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/bank-accounts`)
        .set(...AUTH)
        .send({
          ...BANK_BODY,
          provider_name: "<b>BCA</b>",
          account_holder: "<script>alert(1)</script>Budi",
        })
        .expect(201);

      expect(seen.giftInput).toMatchObject({
        providerName: "BCA",
        accountHolder: "Budi",
        // Untouched: the exact characters matter, and the format check is the defence.
        accountNumber: "1234567890",
      });
    });

    it("is 401 without a token", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/invitations/${INVITATION_ID}/bank-accounts`)
        .expect(401);
    });
  });

  describe("quote (P1-13)", () => {
    it("reads and writes", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/invitations/${INVITATION_ID}/quote`)
        .set(...AUTH)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/quote`)
        .set(...AUTH)
        .send({ text: "A quote", source: "Somebody" })
        .expect(200);

      expect(res.body.data.text).toBe("A quote");
    });

    it("sanitizes both fields", async () => {
      seen.quoteInput = undefined;

      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/quote`)
        .set(...AUTH)
        .send({
          text: "<img src=x onerror=alert(1)>Cinta",
          source: "<b>Ar-Rum</b>: 21",
        })
        .expect(200);

      expect(seen.quoteInput).toEqual({
        text: "Cinta",
        source: "Ar-Rum: 21",
      });
    });

    it("accepts null to clear", async () => {
      seen.quoteInput = undefined;

      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/quote`)
        .set(...AUTH)
        .send({ source: null })
        .expect(200);

      expect(seen.quoteInput).toEqual({ source: null });
    });

    it.each([
      ["an over-long text", { text: "x".repeat(2001) }],
      ["an over-long source", { source: "x".repeat(201) }],
      ["an unknown field", { author: "Somebody" }],
    ])("rejects %s", async (_name, body) => {
      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/quote`)
        .set(...AUTH)
        .send(body)
        .expect(400);
    });

    it("another user's invitation is 404", async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${OTHERS_INVITATION}/quote`)
        .set(...AUTH)
        .send({ text: "Hijacked" })
        .expect(404);
    });
  });

  describe("settings (P1-14)", () => {
    it("reads and writes", async () => {
      const read = await request(app.getHttpServer())
        .get(`/api/v1/invitations/${INVITATION_ID}/settings`)
        .set(...AUTH)
        .expect(200);
      expect(read.body.data.slug).toBe("budi-dan-ani");

      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/settings`)
        .set(...AUTH)
        .send({ rsvp_enabled: false })
        .expect(200);
    });

    it("maps snake_case to the service's camelCase", async () => {
      seen.settingsPatch = undefined;

      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/settings`)
        .set(...AUTH)
        .send({
          enabled_sections: ["hero"],
          theme_override: { colors: { primary: "#fff" } },
          rsvp_enabled: false,
          guestbook_enabled: false,
          guestbook_moderation: true,
          seo_indexable: true,
          slug: "new-address",
          confirm_slug_change: true,
        })
        .expect(200);

      expect(seen.settingsPatch).toEqual({
        enabledSections: ["hero"],
        themeOverride: { colors: { primary: "#fff" } },
        rsvpEnabled: false,
        guestbookEnabled: false,
        guestbookModeration: true,
        seoIndexable: true,
        slug: "new-address",
        confirmSlugChange: true,
      });
    });

    it.each([
      ["status", { status: "published" }],
      ["owner_id", { owner_id: OWNER_ID }],
      [
        "template_version_id",
        { template_version_id: created.templateVersionId },
      ],
      ["expiry_date", { expiry_date: "2030-01-01" }],
      ["published_at", { published_at: "2026-01-01T00:00:00Z" }],
    ])("rejects a body carrying %s", async (_name, extra) => {
      // The settings screen is the most tempting place to smuggle a lifecycle field,
      // because it already writes to `invitations`.
      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/settings`)
        .set(...AUTH)
        .send({ rsvp_enabled: true, ...extra })
        .expect(400);
    });

    it.each([
      ["a non-boolean toggle", { rsvp_enabled: "yes" }],
      ["a non-array enabled_sections", { enabled_sections: "hero" }],
      ["too many sections", { enabled_sections: Array(51).fill("hero") }],
      ["an over-long section key", { enabled_sections: ["x".repeat(41)] }],
      ["a two-character slug", { slug: "ab" }],
      ["a 51-character slug", { slug: "a".repeat(51) }],
    ])("rejects %s", async (_name, body) => {
      await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/settings`)
        .set(...AUTH)
        .send(body)
        .expect(400);
    });

    it("is rate limited on the slug-change policy", async () => {
      // BR-6.2 asks for a rate limit; docs/SECURITY/10's table predates the rule needing a
      // number, so `slug-change` was added there rather than invented at the call site.
      limiterStub.check = async () => ({
        allowed: false,
        limit: 3,
        remaining: 0,
        resetAt: 1789200000,
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${INVITATION_ID}/settings`)
        .set(...AUTH)
        .send({ slug: "new-address" })
        .expect(429);

      expect(res.body.error.code).toBe("TOO_MANY_ATTEMPTS");

      limiterStub.check = async () => ({
        allowed: true,
        limit: 10,
        remaining: 9,
        resetAt: 1789200000,
      });
    });

    it("another user's invitation is 404", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/invitations/${OTHERS_INVITATION}/settings`)
        .set(...AUTH)
        .send({ seo_indexable: true })
        .expect(404);

      expect(res.body.data).toBeUndefined();
    });

    it("is 401 without a token", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/invitations/${INVITATION_ID}/settings`)
        .expect(401);
    });
  });

  describe("change template (P1-15)", () => {
    it("returns the new version and what stops displaying", async () => {
      // docs/UI-UX/05 § Change Template Flow: the confirmation modal lists the affected
      // fields, so the response has to carry them.
      const res = await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/change-template`)
        .set(...AUTH)
        .send({ template_id: NEW_TEMPLATE_ID })
        .expect(200);

      expect(res.body.data).toEqual({
        template_id: NEW_TEMPLATE_ID,
        template_version_id: "88888888-8888-4888-8888-888888888888",
        enabled_sections: ["hero", "quote"],
        hidden_sections: ["gallery"],
        dropped_theme_keys: ["colors.accent"],
      });
      expect(seen.changeTemplateId).toBe(NEW_TEMPLATE_ID);
    });

    it.each([
      [
        "template_version_id",
        { template_version_id: created.templateVersionId },
      ],
      ["enabled_sections", { enabled_sections: ["hero"] }],
      ["theme_override", { theme_override: { colors: { primary: "#fff" } } }],
      ["status", { status: "published" }],
      ["owner_id", { owner_id: OWNER_ID }],
    ])("rejects a body carrying %s", async (_name, extra) => {
      // Each of these is a way to make the server compute something other than the
      // consequence of the change: a draft version (BR-3.3), a section the new template
      // does not define (P1-14), or a lifecycle field (SECURITY/05 § 3).
      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/change-template`)
        .set(...AUTH)
        .send({ template_id: NEW_TEMPLATE_ID, ...extra })
        .expect(400);
    });

    it.each([
      ["a missing template_id", {}],
      ["a non-uuid template_id", { template_id: "not-a-uuid" }],
      ["a null template_id", { template_id: null }],
    ])("rejects %s", async (_name, body) => {
      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/change-template`)
        .set(...AUTH)
        .send(body)
        .expect(400);
    });

    it("another user's invitation is 404 and leaks nothing", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/invitations/${OTHERS_INVITATION}/change-template`)
        .set(...AUTH)
        .send({ template_id: NEW_TEMPLATE_ID })
        .expect(404);

      expect(res.body.data).toBeUndefined();
    });

    it("is 401 without a token", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/change-template`)
        .send({ template_id: NEW_TEMPLATE_ID })
        .expect(401);
    });

    it("is rate limited", async () => {
      limiterStub.check = async () => ({
        allowed: false,
        limit: 300,
        remaining: 0,
        resetAt: 1789200000,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/change-template`)
        .set(...AUTH)
        .send({ template_id: NEW_TEMPLATE_ID })
        .expect(429);

      expect(res.body.error.code).toBe("TOO_MANY_ATTEMPTS");
    });
  });
});
