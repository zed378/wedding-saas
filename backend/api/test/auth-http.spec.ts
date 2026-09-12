import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { ENV } from "../src/config/config.module";
import type { Env } from "../src/config/env.schema";
import { AuthController } from "../src/modules/auth/auth.controller";
import {
  InvalidCredentialsError,
  LoginService,
  type Session,
} from "../src/modules/auth/login.service";
import { SessionService } from "../src/modules/auth/session.service";
import { GoogleOAuthService } from "../src/modules/auth/oauth/google-oauth.service";
import { PasswordResetService } from "../src/modules/auth/password-reset.service";
import {
  POLICY_REGISTRY,
  RATE_LIMITER,
} from "../src/shared/rate-limit/rate-limit.guard";
import { PolicyRegistry } from "../src/shared/rate-limit/config";
import type { RateLimitDecision } from "../src/shared/rate-limit/rate-limiter";
import { RateLimiterUnavailableError } from "../src/shared/rate-limit/rate-limiter";
import { RegistrationService } from "../src/modules/auth/registration.service";
import { REFRESH_COOKIE_NAME } from "../src/modules/auth/tokens/refresh-token.service";
import { UnauthenticatedError } from "../src/http/errors";

/**
 * P1-03 at the HTTP layer.
 *
 * The cookie attributes are the reason this file exists. `HttpOnly`, `Secure` and
 * `SameSite=Lax` ARE the control that `docs/SECURITY/03` § Tokens specifies — a refresh
 * token in a readable cookie is a refresh token an XSS has for thirty days — and none of
 * them is observable from the service layer. They only exist in a response header, so
 * only a test that reads the header can prove they are there.
 *
 * The services are stubs. What is under test is the controller, the cookie, and the
 * envelope; the behaviour behind them has its own integration suite.
 */

const REFRESH_TOKEN = "the-refresh-token-value-nobody-should-see";
const EXPIRES_AT = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

const session: Session = {
  accessToken: "the.access.token",
  refresh: { token: REFRESH_TOKEN, expiresAt: EXPIRES_AT },
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "budi@example.test",
    fullName: "Budi Santoso",
    role: "user",
    emailVerified: true,
  },
};

/** Records what the controller passed down, so the cookie can be traced to its source. */
const seen: {
  refreshArg?: string | undefined;
  logoutArg?: string | undefined;
  googleBody?: unknown;
  forgotEmail?: string;
  recordedFailure?: boolean;
} = {};

const resetStub = {
  request: async (email: string) => {
    seen.forgotEmail = email;
  },
  reset: async (token: string) =>
    token === "good-token"
      ? ({ status: "ok" } as const)
      : token === "expired-token"
        ? ({ status: "expired" } as const)
        : ({ status: "invalid" } as const),
};

/**
 * The limiter, faked. What is under test here is the GUARD -- the headers it sets, the
 * 429 it raises and the 503 it raises instead when a fail-closed policy cannot reach
 * Redis. The window arithmetic has its own suite against a real Redis.
 */
let nextDecision: RateLimitDecision | "unavailable" = {
  allowed: true,
  limit: 5,
  remaining: 4,
  resetAt: 1789200000,
};

const limiterStub = {
  check: async (policy: { name: string }) => {
    if (nextDecision === "unavailable") {
      throw new RateLimiterUnavailableError(policy.name);
    }
    return nextDecision;
  },
  recordFailure: async () => {
    seen.recordedFailure = true;
  },
  block: async () => 900,
};

const googleStub = {
  authenticate: async (idToken: string) => {
    seen.googleBody = idToken;
    return { session, outcome: "registered" as const };
  },
};

const loginStub = {
  login: async (email: string) => {
    if (email !== "budi@example.test") throw new InvalidCredentialsError();
    return session;
  },
  refresh: async (token: string | undefined) => {
    seen.refreshArg = token;
    if (token === undefined) throw new UnauthenticatedError();
    return session;
  },
  logout: async (token: string | undefined) => {
    seen.logoutArg = token;
  },
};

const sessionStub = {
  authenticate: async (header: string | undefined) => {
    if (header !== "Bearer good") throw new UnauthenticatedError();
    return session.user;
  },
};

/** https, so the Secure attribute is expected. See `refresh-cookie.ts`. */
const env = { APP_ORIGIN: "https://app.example.test" } as unknown as Env;

describe("auth endpoints over HTTP", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: APP_FILTER, useClass: AppExceptionFilter },
        { provide: LoginService, useValue: loginStub },
        { provide: SessionService, useValue: sessionStub },
        { provide: GoogleOAuthService, useValue: googleStub },
        { provide: PasswordResetService, useValue: resetStub },
        { provide: RegistrationService, useValue: {} },
        { provide: ENV, useValue: env },
        { provide: RATE_LIMITER, useValue: limiterStub },
        {
          provide: POLICY_REGISTRY,
          useValue: new PolicyRegistry(undefined, undefined),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const cookieHeader = (res: request.Response): string => {
    const raw = res.headers["set-cookie"];
    const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    return list.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`)) ?? "";
  };

  describe("POST /auth/login", () => {
    it("returns the documented body", async () => {
      // docs/API/01 § Example Response.
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "budi@example.test", password: "whatever" })
        .expect(200);

      expect(res.body).toEqual({
        success: true,
        data: {
          access_token: "the.access.token",
          user: {
            id: session.user.id,
            email: "budi@example.test",
            full_name: "Budi Santoso",
            role: "user",
            email_verified: true,
          },
        },
      });
    });

    it("never puts the refresh token in the body", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "budi@example.test", password: "whatever" });

      expect(JSON.stringify(res.body)).not.toContain(REFRESH_TOKEN);
    });

    it("sets the refresh token as a cookie", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "budi@example.test", password: "whatever" });

      expect(cookieHeader(res)).toContain(
        `${REFRESH_COOKIE_NAME}=${REFRESH_TOKEN}`,
      );
    });

    it.each(["HttpOnly", "Secure", "SameSite=Lax"])(
      "the cookie carries %s",
      async (attribute) => {
        // docs/SECURITY/03 § Tokens, attribute for attribute. Each is a separate case so
        // a failure names which one was dropped.
        const res = await request(app.getHttpServer())
          .post("/api/v1/auth/login")
          .send({ email: "budi@example.test", password: "whatever" });

        expect(cookieHeader(res)).toMatch(new RegExp(attribute, "i"));
      },
    );

    it("scopes the cookie to the auth path", async () => {
      // Not sent on the hundreds of API requests that have no use for it.
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "budi@example.test", password: "whatever" });

      expect(cookieHeader(res)).toContain("Path=/api/v1/auth");
    });

    it("returns INVALID_CREDENTIALS, in the error envelope", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "nobody@example.test", password: "whatever" })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("rejects a malformed body before reaching the service", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "not-an-email", password: "" })
        .expect(400);
    });
  });

  describe("POST /auth/oauth/google", () => {
    it("passes the id_token down and returns the login shape", async () => {
      // Step 6: nothing downstream should be able to tell how a session began.
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/oauth/google")
        .send({ id_token: "an-opaque-google-token" })
        .expect(200);

      expect(seen.googleBody).toBe("an-opaque-google-token");
      expect(res.body.data).toHaveProperty("access_token");
      expect(res.body.data).toHaveProperty("user");
    });

    it("an email in the body does not survive parsing", async () => {
      // docs/SECURITY/03: "NEVER trust the email from the request body." The schema has
      // one field and Zod strips the rest, so there is nothing for a later edit to
      // accidentally start reading.
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/oauth/google")
        .send({
          id_token: "an-opaque-google-token",
          email: "attacker@example.test",
        })
        .expect(200);

      expect(JSON.stringify(res.body)).not.toContain("attacker@example.test");
      expect(seen.googleBody).toBe("an-opaque-google-token");
    });

    it("sets the refresh cookie, with the same attributes", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/oauth/google")
        .send({ id_token: "an-opaque-google-token" });

      expect(cookieHeader(res)).toMatch(/HttpOnly/i);
      expect(cookieHeader(res)).toMatch(/SameSite=Lax/i);
    });

    it("rejects a missing or oversized id_token", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/oauth/google")
        .send({})
        .expect(400);

      await request(app.getHttpServer())
        .post("/api/v1/auth/oauth/google")
        .send({ id_token: "x".repeat(9000) })
        .expect(400);
    });

    it("maps an unavailable provider to 503, not 401", async () => {
      const { ServiceUnavailableError } = await import("../src/http/errors.js");
      const original = googleStub.authenticate;
      googleStub.authenticate = async () => {
        throw new ServiceUnavailableError();
      };

      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/oauth/google")
        .send({ id_token: "a-fine-token" })
        .expect(503);

      expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
      googleStub.authenticate = original;
    });
  });

  describe("POST /auth/refresh", () => {
    it("reads the token from the cookie", async () => {
      seen.refreshArg = undefined;

      await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", [`${REFRESH_COOKIE_NAME}=a-presented-token`])
        .expect(200);

      expect(seen.refreshArg).toBe("a-presented-token");
    });

    it("ignores a token in the body", async () => {
      // The cookie is the ONLY channel. A body fallback would let a client keep the
      // token somewhere a script can read, which is what HttpOnly exists to prevent.
      seen.refreshArg = "sentinel";

      await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .send({ refresh_token: "a-token-in-the-body" })
        .expect(401);

      expect(seen.refreshArg).toBeUndefined();
    });

    it("sets a new cookie on the way out", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", [`${REFRESH_COOKIE_NAME}=a-presented-token`]);

      expect(cookieHeader(res)).toContain(REFRESH_TOKEN);
      expect(cookieHeader(res)).toMatch(/HttpOnly/i);
    });

    it("is 401 with no cookie at all", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .expect(401);
    });
  });

  describe("POST /auth/logout", () => {
    it("passes the cookie to the service, then clears it", async () => {
      // Both halves matter: clearing the cookie without revoking leaves the token
      // working for thirty days for anyone who copied it.
      seen.logoutArg = undefined;

      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/logout")
        .set("Cookie", [`${REFRESH_COOKIE_NAME}=to-be-revoked`])
        .expect(200);

      expect(seen.logoutArg).toBe("to-be-revoked");
      // Cleared with the SAME attributes it was set with -- a mismatch leaves the
      // original cookie in place and makes logout look like it worked.
      const cleared = cookieHeader(res);
      expect(cleared).toContain("Path=/api/v1/auth");
      expect(cleared).toMatch(/HttpOnly/i);
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
    });

    it("succeeds with no cookie", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/logout")
        .expect(200);
    });
  });

  describe("password reset endpoints", () => {
    it("forgot-password lowercases nothing at the edge and always answers 200", async () => {
      // Uniform: the same body for a known address, an unknown one, a suspended account
      // and an OAuth-only one. The service decides; the controller cannot leak.
      for (const email of ["budi@example.test", "nobody@example.test"]) {
        const res = await request(app.getHttpServer())
          .post("/api/v1/auth/forgot-password")
          .send({ email })
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("message");
      }
    });

    it("forgot-password rejects a malformed address", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/forgot-password")
        .send({ email: "not-an-address" })
        .expect(400);
    });

    it("reset-password succeeds with a good token", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/reset-password")
        .send({ token: "good-token", new_password: "a-fine-new-password-99" })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it.each([
      ["an expired token", "expired-token"],
      ["an unknown token", "nonsense"],
    ])("reset-password refuses %s with 400", async (_name, token) => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/reset-password")
        .send({ token, new_password: "a-fine-new-password-99" })
        .expect(400);

      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("reset-password takes no user id", async () => {
      // Structural: the schema is { token, new_password }. A user_id sent alongside does
      // not survive parsing, so one person cannot reset another's password.
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/reset-password")
        .send({
          token: "good-token",
          new_password: "a-fine-new-password-99",
          user_id: "11111111-1111-4111-8111-111111111111",
        })
        .expect(200);

      expect(JSON.stringify(res.body)).not.toContain("11111111");
    });
  });

  describe("rate limiting (P1-07)", () => {
    it("sets the three headers docs/API/00 names, on a SUCCESSFUL response", async () => {
      // Not only on refusals. A client can only back off before hitting a wall if it can
      // see the wall coming, and a Remaining that appears in the 429 arrives exactly one
      // request too late.
      nextDecision = {
        allowed: true,
        limit: 5,
        remaining: 3,
        resetAt: 1789200000,
      };

      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "budi@example.test", password: "whatever" })
        .expect(200);

      expect(res.headers["x-ratelimit-limit"]).toBe("5");
      expect(res.headers["x-ratelimit-remaining"]).toBe("3");
      expect(res.headers["x-ratelimit-reset"]).toBe("1789200000");
    });

    it("refuses with 429 and the standard envelope", async () => {
      nextDecision = {
        allowed: false,
        limit: 5,
        remaining: 0,
        resetAt: 1789200000,
        retryAfterSeconds: 300,
      };

      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "budi@example.test", password: "whatever" })
        .expect(429);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("TOO_MANY_ATTEMPTS");
      expect(res.headers["retry-after"]).toBe("300");
    });

    it("a refused request never reaches the service", async () => {
      // The point of limiting a credential endpoint: the expensive argon2 verify must
      // not run for an attacker who is already over budget.
      nextDecision = {
        allowed: false,
        limit: 5,
        remaining: 0,
        resetAt: 1789200000,
      };
      seen.recordedFailure = false;

      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "nobody@example.test", password: "whatever" })
        .expect(429);

      expect(seen.recordedFailure).toBe(false);
    });

    it("a Redis outage on a credential endpoint is 503, not 429", async () => {
      // ADR-050. A 429 would tell the client to slow down, which is false, and a client
      // with backoff would wait for a limit that is not the problem.
      nextDecision = "unavailable";

      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "budi@example.test", password: "whatever" })
        .expect(503);

      expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");

      nextDecision = { allowed: true, limit: 5, remaining: 4, resetAt: 1 };
    });

    it("a failed login is recorded against the budget; a successful one is not", async () => {
      // docs/SECURITY/10 counts FAILED attempts. The guard runs before the attempt and
      // cannot know, so the controller records after.
      nextDecision = { allowed: true, limit: 5, remaining: 4, resetAt: 1 };

      seen.recordedFailure = false;
      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "budi@example.test", password: "whatever" })
        .expect(200);
      expect(seen.recordedFailure).toBe(false);

      seen.recordedFailure = false;
      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "nobody@example.test", password: "whatever" })
        .expect(401);
      expect(seen.recordedFailure).toBe(true);
    });

    it("forgot-password is limited (the obligation inherited from P1-05)", async () => {
      nextDecision = {
        allowed: false,
        limit: 3,
        remaining: 0,
        resetAt: 1789200000,
      };

      await request(app.getHttpServer())
        .post("/api/v1/auth/forgot-password")
        .send({ email: "budi@example.test" })
        .expect(429);

      nextDecision = { allowed: true, limit: 5, remaining: 4, resetAt: 1 };
    });

    it.each([
      [
        "register",
        "/api/v1/auth/register",
        { email: "a@b.test", password: "x", full_name: "A" },
      ],
      [
        "reset-password",
        "/api/v1/auth/reset-password",
        { token: "t", new_password: "x" },
      ],
    ])("%s is limited too", async (_name, path, body) => {
      nextDecision = {
        allowed: false,
        limit: 5,
        remaining: 0,
        resetAt: 1789200000,
      };

      await request(app.getHttpServer()).post(path).send(body).expect(429);

      nextDecision = { allowed: true, limit: 5, remaining: 4, resetAt: 1 };
    });
  });

  describe("GET /auth/me", () => {
    it("returns the user for a valid token", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Authorization", "Bearer good")
        .expect(200);

      expect(res.body.data.user.email).toBe("budi@example.test");
    });

    it("is 401 without a token", async () => {
      await request(app.getHttpServer()).get("/api/v1/auth/me").expect(401);
    });

    it("never returns a password hash or an oauth subject", async () => {
      // The projection in `publicUser` rather than a spread of the row.
      const res = await request(app.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Authorization", "Bearer good");

      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/password/i);
      expect(body).not.toMatch(/oauth/i);
    });
  });
});
