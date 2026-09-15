import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { UnauthenticatedError } from "../src/http/errors";
import { SessionService } from "../src/modules/auth/session.service";
import { PublishController } from "../src/modules/publishing/publish.controller";
import { PublishService } from "../src/modules/publishing/publish.service";
import { PolicyRegistry } from "../src/shared/rate-limit/config";
import {
  POLICY_REGISTRY,
  RATE_LIMITER,
} from "../src/shared/rate-limit/rate-limit.guard";

/** `P3-09` at the HTTP layer: the route, the empty body, the response envelope. */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const INVITATION_ID = "33333333-3333-4333-8333-333333333333";
const calls: { invitationId: string; emailVerified: boolean }[] = [];

describe("POST /api/v1/invitations/:id/publish over HTTP", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PublishController],
      providers: [
        { provide: APP_FILTER, useClass: AppExceptionFilter },
        {
          provide: PublishService,
          useValue: {
            publish: async (
              user: { emailVerified: boolean },
              invitationId: string,
            ) => {
              calls.push({ invitationId, emailVerified: user.emailVerified });
              return {
                status: "published",
                slug: "budi-dan-siti",
                url: "https://invitation.test/budi-dan-siti",
                published_at: "2027-05-15T01:00:00.000Z",
                expiry_date: "2027-05-18",
                trial: true,
              };
            },
          },
        },
        {
          provide: SessionService,
          useValue: {
            authenticate: async (header: string | undefined) => {
              if (header !== "Bearer good") throw new UnauthenticatedError();
              return {
                id: USER_ID,
                email: "budi@example.test",
                fullName: "Budi",
                role: "user",
                emailVerified: true,
              };
            },
          },
        },
        {
          provide: RATE_LIMITER,
          useValue: {
            check: async () => ({
              allowed: true,
              limit: 300,
              remaining: 299,
              resetAt: 1789200000,
            }),
            recordFailure: async () => {},
            block: async () => 900,
          },
        },
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
    calls.length = 0;
  });

  const post = () =>
    request(app.getHttpServer())
      .post(`/api/v1/invitations/${INVITATION_ID}/publish`)
      .set("Authorization", "Bearer good");

  it("publishes: 200 with the address and the dates", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      status: "published",
      slug: "budi-dan-siti",
      url: "https://invitation.test/budi-dan-siti",
      published_at: "2027-05-15T01:00:00.000Z",
      expiry_date: "2027-05-18",
      trial: true,
    });
    expect(calls).toEqual([
      { invitationId: INVITATION_ID, emailVerified: true },
    ]);
  });

  it.each([
    ["an expiry date", { expiry_date: "2099-01-01" }],
    ["a trial flag", { trial: false }],
    ["a status", { status: "published" }],
  ])(
    "refuses %s in the body without calling the service",
    async (_label, body) => {
      const res = await post().send(body);
      expect(res.status).toBe(400);
      expect(calls).toEqual([]);
    },
  );

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer()).post(
      `/api/v1/invitations/${INVITATION_ID}/publish`,
    );
    expect(res.status).toBe(401);
  });
});
