import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { InvitationController } from "../src/modules/invitation/invitation.controller";
import { InvitationCreateService } from "../src/modules/invitation/invitation-create.service";
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

const seen: { input?: unknown; scope?: unknown } = {};

const createStub = {
  create: async (scope: unknown, input: unknown) => {
    seen.scope = scope;
    seen.input = input;
    return created;
  },
};

const OWNER_ID = "11111111-1111-4111-8111-111111111111";

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
});
