import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  RequestMethod,
  type INestApplication,
  type Type,
} from "@nestjs/common";
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AdminModule } from "../src/modules/admin/admin.module";
import { AppExceptionFilter } from "../src/http/exception.filter";
import { SessionService } from "../src/modules/auth/session.service";
import { signAccessToken } from "../src/modules/auth/tokens/access-token.service";
import type { Database } from "../src/infra/db/client";
import type { Env } from "../src/config/env.schema";
import { MfaService } from "../src/modules/auth/mfa/mfa.service";

const ordinaryId = "22222222-2222-4222-8222-222222222222";
const adminId = "33333333-3333-4333-8333-333333333333";

// Discover the deployed module's controllers so a new admin route joins the sweep.
const controllers: Type<unknown>[] = Reflect.getMetadata(
  MODULE_METADATA.CONTROLLERS,
  AdminModule,
);
const routes = controllers.flatMap((controller) => {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
  return Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
    const handler = controller.prototype[name];
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as
      RequestMethod | undefined;
    if (method === undefined) return [];
    const suffix = Reflect.getMetadata(PATH_METADATA, handler) as string;
    return [
      {
        method: RequestMethod[method]!.toLowerCase(),
        path: `/${base}/${suffix}`
          .replace(/\/$/, "")
          .replace(/:[^/]+/g, "11111111-1111-4111-8111-111111111111"),
      },
    ];
  });
});

describe("P5-14 every mounted admin route rejects privilege escalation", () => {
  let app: INestApplication;
  let ordinaryToken: string;
  let preMfaAdminToken: string;
  const env = {
    JWT_SIGNING_KEY: "phase5-authorization-sweep-signing-key-32",
  } as Env;
  const sessions = new SessionService({} as Database, env);
  const loadUser = vi
    .spyOn(sessions, "loadActiveUser")
    .mockImplementation(async (id) => ({
      id,
      email: "sweep@example.test",
      fullName: "Sweep",
      role: id === ordinaryId ? "user" : "admin",
      emailVerified: true,
    }));

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers,
      providers: [
        { provide: SessionService, useValue: sessions },
        {
          provide: MfaService,
          useValue: { verifyStepUpToken: async () => false },
        },
        { provide: APP_FILTER, useClass: AppExceptionFilter },
      ],
    })
      .useMocker(() => ({}))
      .compile();
    app = module.createNestApplication();
    await app.init();
    // A forged role claim cannot override the user's current database role.
    ordinaryToken = await signAccessToken(env.JWT_SIGNING_KEY, {
      userId: ordinaryId,
      role: "super_admin",
      emailVerified: true,
    });
    preMfaAdminToken = await signAccessToken(env.JWT_SIGNING_KEY, {
      userId: adminId,
      role: "admin",
      emailVerified: true,
    });
  });
  afterAll(async () => {
    await app?.close();
    loadUser.mockRestore();
  });

  it("covers all nine admin controllers and at least thirty endpoints", () => {
    expect(controllers).toHaveLength(9);
    expect(routes.length).toBeGreaterThanOrEqual(30);
  });

  it("requires step-up for refund and suspension even with an MFA-authenticated session", async () => {
    const token = await signAccessToken(env.JWT_SIGNING_KEY, {
      userId: adminId,
      role: "admin",
      emailVerified: true,
      mfaVerifiedAt: Math.floor(Date.now() / 1000),
    });
    for (const [method, path] of [
      ["post", `/api/v1/admin/orders/${ordinaryId}/refund`],
      ["patch", `/api/v1/admin/users/${ordinaryId}/suspend`],
    ] as const) {
      const response = await request(app.getHttpServer())
        [method](path)
        .set("Authorization", `Bearer ${token}`)
        .send({ reason: "Valid administrative reason" });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("MFA_STEP_UP_REQUIRED");
      const invalid = await request(app.getHttpServer())
        [method](path)
        .set("Authorization", `Bearer ${token}`)
        .set("X-MFA-Step-Up", "forged-step-up-proof")
        .send({ reason: "Valid administrative reason" });
      expect(invalid.status).toBe(403);
      expect(invalid.body.error.code).toBe("MFA_STEP_UP_REQUIRED");
    }
  });

  it("has no invitation content write routes in the real admin module", async () => {
    for (const method of ["patch", "put", "post", "delete"] as const) {
      for (const suffix of [
        "",
        "/couple",
        "/events",
        "/gallery",
        "/bank-accounts",
        "/settings",
      ]) {
        const response = await request(app.getHttpServer())
          [method](`/api/v1/admin/invitations/${ordinaryId}${suffix}`)
          .set("Authorization", `Bearer ${preMfaAdminToken}`)
          .send({ groom_name: "Attempted content edit" });
        expect(response.status).toBe(404);
      }
    }
  });

  for (const { method, path } of routes) {
    it(`${method.toUpperCase()} ${path} refuses ordinary users and unenforced MFA`, async () => {
      for (const [token, status, code] of [
        [undefined, 401, "UNAUTHENTICATED"],
        [ordinaryToken, 403, "FORBIDDEN"],
        [preMfaAdminToken, 401, "UNAUTHENTICATED"],
      ] as const) {
        const client = request(app.getHttpServer());
        const call =
          client[method as "get" | "post" | "patch" | "delete" | "put"](path);
        if (token) call.set("Authorization", `Bearer ${token}`);
        const response = await call.send({
          role: "super_admin",
          reason: "Attempted escalation",
        });
        expect(response.status, `${method} ${path}`).toBe(status);
        expect(response.body.error.code).toBe(code);
        expect(response.body).not.toHaveProperty("data");
      }
    });
  }
});
