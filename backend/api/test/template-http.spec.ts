import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { TemplateController } from "../src/modules/template/template.controller";
import { TemplateService } from "../src/modules/template/template.service";
import { NotFoundError } from "../src/http/errors";
import {
  POLICY_REGISTRY,
  RATE_LIMITER,
} from "../src/shared/rate-limit/rate-limit.guard";
import { PolicyRegistry } from "../src/shared/rate-limit/config";

/**
 * P2-01 at the HTTP layer.
 *
 * The catalog's own rules are proved against a real database in
 * `test/integration/template-catalog.itest.ts`. What only this file can show is the part
 * that is not in the service at all: that the routes exist at the documented paths, that
 * they answer **without a bearer token**, that the query string is validated rather than
 * passed through, and that a path parameter cannot become an unbounded cache key.
 */

const seen: { list?: unknown; slug?: string; version?: string } = {};

const detail = {
  id: "33333333-3333-4333-8333-333333333333",
  slug: "elegant-rose",
  name: "Elegant Rose",
  category: ["modern", "floral"],
  is_premium: true,
  thumbnail_url: null,
  supported_sections: ["hero", "gallery"],
  current_version: {
    id: "44444444-4444-4444-8444-444444444444",
    version: "1.2.0",
    sections: [],
    theme: {},
    customizable_theme_keys: ["colors.primary"],
    status: "published",
  },
};

const serviceStub = {
  list: async (query: unknown) => {
    seen.list = query;
    return { items: [detail], total: 1 };
  },
  detail: async (slug: string) => {
    seen.slug = slug;
    if (slug !== "elegant-rose") throw new NotFoundError();
    return detail;
  },
  version: async (slug: string, version: string) => {
    seen.slug = slug;
    seen.version = version;
    return detail;
  },
};

describe("template catalog HTTP", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TemplateController],
      providers: [
        { provide: TemplateService, useValue: serviceStub },
        { provide: APP_FILTER, useClass: AppExceptionFilter },
        // A limiter that always allows. The limiter has its own suite; here it would only
        // add a Redis dependency to a test about routing.
        {
          provide: RATE_LIMITER,
          useValue: {
            check: async () => ({ allowed: true, remaining: 99, resetAt: 0 }),
            recordFailure: async () => undefined,
          },
        },
        {
          provide: POLICY_REGISTRY,
          useValue: new PolicyRegistry(undefined as never, undefined),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe("the routes docs/API/03 names", () => {
    it("serves the catalog with no Authorization header at all", async () => {
      // `docs/UI-UX/11`: a visitor browses the catalog before they have an account, and
      // is redirected to register only once they pick one. A 401 here would make the
      // marketing site unusable to exactly the people it exists for.
      const response = await request(app.getHttpServer())
        .get("/api/v1/templates")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.meta).toMatchObject({ page: 1, total: 1 });
    });

    it("serves a detail by slug", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/templates/elegant-rose")
        .expect(200);

      expect(response.body.data.slug).toBe("elegant-rose");
      expect(response.body.data.current_version.version).toBe("1.2.0");
    });

    it("serves a named version", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/templates/elegant-rose/versions/1.2.0")
        .expect(200);

      expect(seen.version).toBe("1.2.0");
    });

    it("answers 404 for an unknown slug, in the documented envelope", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/templates/no-such-thing")
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("NOT_FOUND");
      expect(response.body).not.toHaveProperty("data");
    });

    it("does not let /versions/ be read as a slug", async () => {
      // Nest matches in declaration order and `:slug` is declared first. The three-segment
      // route still has to win for its own shape -- `P1-21` lost a day to the mirror
      // image of this.
      await request(app.getHttpServer())
        .get("/api/v1/templates/elegant-rose/versions/1.2.0")
        .expect(200);

      expect(seen.slug).toBe("elegant-rose");
    });
  });

  describe("the query string is validated, not forwarded", () => {
    it("passes the documented filters through", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/templates?category=floral&search=mawar&is_premium=true")
        .expect(200);

      expect(seen.list).toMatchObject({
        category: "floral",
        search: "mawar",
        isPremium: true,
      });
    });

    it("rejects an unknown filter rather than ignoring it", async () => {
      // A typo in a filter name silently returning the unfiltered catalog is worse than
      // an error: the client believes it filtered.
      const response = await request(app.getHttpServer())
        .get("/api/v1/templates?is_premum=true")
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects a non-boolean is_premium", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/templates?is_premium=yes")
        .expect(400);
    });

    it("refuses a per_page above the documented maximum", async () => {
      // `docs/API/00`: max 100. Rejecting rather than clamping, so a client paginating
      // with a larger page size learns it, instead of silently skipping records.
      await request(app.getHttpServer())
        .get("/api/v1/templates?per_page=100000")
        .expect(400);
    });
  });

  describe("path parameters are bounded", () => {
    it("refuses a slug that is not slug-shaped", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/templates/Not%20A%20Slug")
        .expect(400);
    });

    it("refuses a version that is not version-shaped", async () => {
      // Both parameters reach a cache key. An unbounded one is a way to fill Redis with
      // one entry per distinct string, from an endpoint that needs no credentials.
      await request(app.getHttpServer())
        .get("/api/v1/templates/elegant-rose/versions/not-a-version")
        .expect(400);
    });

    it("refuses an absurdly long version string", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/templates/elegant-rose/versions/${"9".repeat(400)}`)
        .expect(400);
    });
  });
});
