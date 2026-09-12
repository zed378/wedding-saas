import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { ENV } from "../src/config/config.module";
import type { Env } from "../src/config/env.schema";
import { UserController } from "../src/modules/user/user.controller";
import { UserService } from "../src/modules/user/user.service";
import { SessionService } from "../src/modules/auth/session.service";
import { UnauthenticatedError } from "../src/http/errors";

/**
 * P1-08 at the HTTP layer.
 *
 * Two things exist only here and are the reason for the file.
 *
 * **Every path is `/users/me`.** `docs/API/02` § Object-Level Authorization asks for IDOR
 * prevention by design; the design is that there is no `:id` segment. A test that a
 * crafted `/users/{someone-elses-id}` 404s is meaningless — the route does not exist —
 * but a test that the controller *has no such route* is worth having, because adding one
 * is exactly how this guarantee would be lost.
 *
 * **`.strict()` rejects rather than strips.** The service-layer mass-assignment tests
 * prove the write is safe. This proves the caller is *told*, which is what makes an
 * attempt visible in a log rather than a silent no-op.
 */

const profile = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "budi@example.test",
  fullName: "Budi Santoso",
  phone: null as string | null,
  role: "user",
  emailVerified: true,
  createdAt: new Date("2026-01-05T02:00:00.000Z"),
};

const seen: { update?: unknown; changePassword?: unknown } = {};

const userStub = {
  getProfile: async () => profile,
  updateProfile: async (_scope: string, changes: unknown) => {
    seen.update = changes;
    return profile;
  },
  changePassword: async (..._args: unknown[]) => {
    seen.changePassword = _args;
    return { sessionsRevoked: 2 };
  },
  getPreferences: async () => ({
    rsvpEmail: true,
    guestbookEmail: true,
    marketingEmail: false,
  }),
  updatePreferences: async () => ({
    rsvpEmail: false,
    guestbookEmail: true,
    marketingEmail: false,
  }),
  requestDeletion: async () => ({
    status: "scheduled" as const,
    liveInvitations: 2,
  }),
};

const sessionStub = {
  authenticate: async (header: string | undefined) => {
    if (header !== "Bearer good") throw new UnauthenticatedError();
    return {
      id: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      role: "user",
      emailVerified: true,
    };
  },
};

const env = {
  APP_ORIGIN: "https://app.example.test",
  REFRESH_TOKEN_PEPPER: "p".repeat(48),
} as unknown as Env;

const AUTH = ["Authorization", "Bearer good"] as const;

describe("user endpoints over HTTP", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: APP_FILTER, useClass: AppExceptionFilter },
        { provide: UserService, useValue: userStub },
        { provide: SessionService, useValue: sessionStub },
        { provide: ENV, useValue: env },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("no endpoint accepts a user identifier (the DoD's first item)", () => {
    it.each([
      ["GET", "/api/v1/users/22222222-2222-4222-8222-222222222222"],
      [
        "GET",
        "/api/v1/users/22222222-2222-4222-8222-222222222222/notification-preferences",
      ],
    ])("%s %s does not exist", async (method, path) => {
      // Not "is forbidden" -- does not exist. There is no route with a parameter, so
      // there is nothing to authorise and nothing to get wrong.
      const res = await request(app.getHttpServer())
        [method.toLowerCase() as "get"](path)
        .set(...AUTH);

      expect(res.status).toBe(404);
    });

    it("a user_id in the body does not survive parsing", async () => {
      const res = await request(app.getHttpServer())
        .patch("/api/v1/users/me")
        .set(...AUTH)
        .send({
          full_name: "Budi",
          user_id: "22222222-2222-4222-8222-222222222222",
        });

      // `.strict()`: rejected outright, so the attempt is visible rather than silent.
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain("user_id");
    });
  });

  describe("every route requires authentication", () => {
    it.each([
      ["get", "/api/v1/users/me"],
      ["patch", "/api/v1/users/me"],
      ["post", "/api/v1/users/me/change-password"],
      ["get", "/api/v1/users/me/notification-preferences"],
      ["patch", "/api/v1/users/me/notification-preferences"],
      ["delete", "/api/v1/users/me"],
    ])("%s %s is 401 without a token", async (method, path) => {
      await request(app.getHttpServer())
        [method as "get"](path)
        .send({})
        .expect(401);
    });
  });

  describe("GET /users/me", () => {
    it("returns docs/API/02's example shape", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/users/me")
        .set(...AUTH)
        .expect(200);

      expect(res.body.data).toEqual({
        id: profile.id,
        email: "budi@example.test",
        full_name: "Budi Santoso",
        phone: null,
        role: "user",
        email_verified: true,
        created_at: "2026-01-05T02:00:00.000Z",
      });
    });
  });

  describe("PATCH /users/me", () => {
    it.each([
      ["role", { role: "admin" }],
      ["email", { email: "new@example.test" }],
      ["email_verified", { email_verified: true }],
      ["status", { status: "active" }],
      ["password_hash", { password_hash: "x" }],
    ])(
      "rejects a request carrying %s (the DoD's second item)",
      async (field, extra) => {
        const res = await request(app.getHttpServer())
          .patch("/api/v1/users/me")
          .set(...AUTH)
          .send({ full_name: "Budi", ...extra })
          .expect(400);

        expect(res.body.error.code).toBe("VALIDATION_ERROR");
        expect(JSON.stringify(res.body)).toContain(field);
      },
    );

    it("sanitizes full_name before it reaches the service (P1-16)", async () => {
      // The field renders on the dashboard and, once P2 ships the renderer, on a public
      // page seen by hundreds of guests. docs/SECURITY/08 calls stored XSS the primary
      // risk here, and the defence is BEFORE storage, not at render time.
      seen.update = undefined;

      await request(app.getHttpServer())
        .patch("/api/v1/users/me")
        .set(...AUTH)
        .send({ full_name: "<img src=x onerror=alert(1)>Budi" })
        .expect(200);

      expect(seen.update).toEqual({ fullName: "Budi" });
    });

    it("validates length BEFORE sanitizing, not after", async () => {
      // The ordering bug: sanitize first and a 3000-character payload that shrinks to 90
      // passes a length check it should have failed.
      await request(app.getHttpServer())
        .patch("/api/v1/users/me")
        .set(...AUTH)
        .send({ full_name: `<b>${"x".repeat(200)}</b>` })
        .expect(400);
    });

    it("passes only the whitelisted fields to the service", async () => {
      seen.update = undefined;

      await request(app.getHttpServer())
        .patch("/api/v1/users/me")
        .set(...AUTH)
        .send({ full_name: "Budi Wijaya", phone: "081234567890" })
        .expect(200);

      expect(seen.update).toEqual({
        fullName: "Budi Wijaya",
        phone: "081234567890",
      });
    });

    it.each([
      ["+6281234567890", true],
      ["6281234567890", true],
      ["081234567890", true],
      ["0812345678901", true],
      ["", true],
      ["12345", false],
      ["+1 555 0100", false],
      ["08123", false],
      ["not a number", false],
      ["+62812345678901234567890", false],
    ])("phone %j is %s", async (phone, valid) => {
      // docs/API/02 points at docs/BACKEND/03 for this format, which does not define one.
      // The gap is recorded; this is the rule as implemented.
      const res = await request(app.getHttpServer())
        .patch("/api/v1/users/me")
        .set(...AUTH)
        .send({ phone });

      expect(res.status).toBe(valid ? 200 : 400);
    });

    it.each([
      ["a", 400],
      ["ab", 200],
      ["x".repeat(100), 200],
      ["x".repeat(101), 400],
    ])("full_name %j -> %i", async (full_name, status) => {
      // docs/API/02 § Validation: 2-100 characters.
      await request(app.getHttpServer())
        .patch("/api/v1/users/me")
        .set(...AUTH)
        .send({ full_name })
        .expect(status);
    });
  });

  describe("POST /users/me/change-password", () => {
    it("hands the current refresh cookie down so that session is spared", async () => {
      seen.changePassword = undefined;

      const res = await request(app.getHttpServer())
        .post("/api/v1/users/me/change-password")
        .set(...AUTH)
        .set("Cookie", ["wi_refresh=the-current-session"])
        .send({ old_password: "old", new_password: "a-fine-new-password-99" })
        .expect(200);

      expect(res.body.data.sessions_revoked).toBe(2);
      expect(seen.changePassword).toEqual([
        profile.id,
        "old",
        "a-fine-new-password-99",
        "the-current-session",
        env.REFRESH_TOKEN_PEPPER,
      ]);
    });

    it("rejects a body with extra fields", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/users/me/change-password")
        .set(...AUTH)
        .send({
          old_password: "old",
          new_password: "new",
          user_id: "22222222-2222-4222-8222-222222222222",
        })
        .expect(400);
    });
  });

  describe("notification preferences", () => {
    it("reads and writes snake_case", async () => {
      const read = await request(app.getHttpServer())
        .get("/api/v1/users/me/notification-preferences")
        .set(...AUTH)
        .expect(200);
      expect(read.body.data).toEqual({
        rsvp_email: true,
        guestbook_email: true,
        marketing_email: false,
      });

      const write = await request(app.getHttpServer())
        .patch("/api/v1/users/me/notification-preferences")
        .set(...AUTH)
        .send({ rsvp_email: false })
        .expect(200);
      expect(write.body.data.rsvp_email).toBe(false);
    });

    it("rejects a non-boolean", async () => {
      await request(app.getHttpServer())
        .patch("/api/v1/users/me/notification-preferences")
        .set(...AUTH)
        .send({ rsvp_email: "yes" })
        .expect(400);
    });
  });

  describe("DELETE /users/me", () => {
    it("says what happens to published invitations", async () => {
      // ADR-051. A user who deletes their account and finds their wedding page still up
      // should have been told that was the intent.
      const res = await request(app.getHttpServer())
        .delete("/api/v1/users/me")
        .set(...AUTH)
        .expect(200);

      expect(res.body.data.status).toBe("scheduled");
      expect(res.body.data.live_invitations).toBe(2);
      expect(res.body.data.message).toMatch(/undangan/i);
    });

    it("clears the refresh cookie", async () => {
      const res = await request(app.getHttpServer())
        .delete("/api/v1/users/me")
        .set(...AUTH)
        .set("Cookie", ["wi_refresh=doomed"]);

      const raw = res.headers["set-cookie"];
      const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
      expect(list.some((c) => c.startsWith("wi_refresh="))).toBe(true);
    });
  });
});
