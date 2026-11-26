import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createHash } from "node:crypto";
import { AdminSlugBlocklistController } from "../src/modules/admin/admin-slug-blocklist.controller";
import { AdminSlugBlocklistService } from "../src/modules/admin/admin-slug-blocklist.service";
import { SessionService } from "../src/modules/auth/session.service";
import { AppExceptionFilter } from "../src/http/exception.filter";
import { NotFoundError, UnauthenticatedError } from "../src/http/errors";
import {
  POLICY_REGISTRY,
  RATE_LIMITER,
} from "../src/shared/rate-limit/rate-limit.guard";
import { PolicyRegistry } from "../src/shared/rate-limit/config";
import { SlugService } from "../src/modules/invitation/slug.service";
import type { Database } from "../src/infra/db/client";
import type { CachePort } from "../src/infra/cache/cache.port";
import type { InvitationRepository } from "../src/shared/tenancy/invitation-repository";
import { slugBlocklistWriteSchema } from "../src/modules/admin/schemas/admin-slug-blocklist.schema";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID = "11111111-1111-4111-8111-111111111111";
const url = "/api/v1/admin/slug-blocklist";
const payload = {
  term: "example",
  match_type: "exact",
  category: "other",
  reason: "Support request",
};

describe("P5-13 admin slug blocklist HTTP boundary", () => {
  let app: INestApplication;
  const service = {
    list: vi.fn(async () => ({
      data: [],
      meta: { page: 1, per_page: 20, total: 0 },
    })),
    test: vi.fn(async () => ({
      blocked: false,
      valid_format: true,
      matching_term: null,
    })),
    save: vi.fn(async (_admin: string, _body: unknown, id?: string) => {
      if (id) throw new NotFoundError();
      return { entry: { id: ID } };
    }),
    remove: vi.fn(async () => {
      throw new NotFoundError();
    }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminSlugBlocklistController],
      providers: [
        { provide: AdminSlugBlocklistService, useValue: service },
        {
          provide: SessionService,
          useValue: {
            authenticate: async (header?: string) => {
              if (!header) throw new UnauthenticatedError();
              return {
                id: ADMIN,
                role: header === "Bearer admin" ? "admin" : "user",
                emailVerified: true,
              };
            },
          },
        },
        {
          provide: RATE_LIMITER,
          useValue: {
            check: vi.fn().mockResolvedValue({
              allowed: true,
              limit: 300,
              remaining: 299,
              resetAt: Date.now() + 60000,
            }),
          },
        },
        {
          provide: POLICY_REGISTRY,
          useValue: new PolicyRegistry(undefined, undefined),
        },
        { provide: APP_FILTER, useClass: AppExceptionFilter },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  it("returns API/00 pagination envelope", async () => {
    const res = await request(app.getHttpServer())
      .get(url)
      .set("Authorization", "Bearer admin");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: [],
      meta: { page: 1, per_page: 20, total: 0 },
    });
  });
  it("requires authentication", async () => {
    expect((await request(app.getHttpServer()).get(url)).status).toBe(401);
  });
  it.each(["post", "patch", "delete"] as const)(
    "ordinary user cannot %s platform configuration or reveal its contents",
    async (method) => {
      const res = await request(app.getHttpServer())
        [method](method === "post" ? url : `${url}/${ID}`)
        .set("Authorization", "Bearer user")
        .send(payload);
      expect(res.status).toBe(403);
      expect(res.body.data).toBeUndefined();
    },
  );
  it("rejects client actor/status/owner_id mass assignment before service", async () => {
    const before = service.save.mock.calls.length;
    const res = await request(app.getHttpServer())
      .post(url)
      .set("Authorization", "Bearer admin")
      .send({
        ...payload,
        role: "super_admin",
        owner_id: ADMIN,
        created_by: ADMIN,
        status: "paid",
      });
    expect(res.status).toBe(400);
    expect(service.save.mock.calls).toHaveLength(before);
  });
  it("sanitizes script reason before service and normalizes uppercase term", async () => {
    const res = await request(app.getHttpServer())
      .post(url)
      .set("Authorization", "Bearer admin")
      .send({
        ...payload,
        term: "EXAMPLE",
        reason: "<script>alert(1)</script>Support request",
      });
    expect(res.status).toBe(201);
    expect(service.save).toHaveBeenLastCalledWith(ADMIN, payload);
  });
  it.each(["patch", "delete"] as const)(
    "%s missing configuration returns identical 404",
    async (method) => {
      const res = await request(app.getHttpServer())
        [method](`${url}/${ID}`)
        .set("Authorization", "Bearer admin")
        .send(method === "patch" ? payload : { reason: payload.reason });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    },
  );
  it("rejects invalid UUID and missing reason", async () => {
    expect(
      (
        await request(app.getHttpServer())
          .patch(`${url}/invalid`)
          .set("Authorization", "Bearer admin")
          .send(payload)
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app.getHttpServer())
          .post(url)
          .set("Authorization", "Bearer admin")
          .send({ term: "bad", match_type: "substring", category: "profanity" })
      ).status,
    ).toBe(400);
  });
  it("test box uses existing enforcement without a write", async () => {
    const res = await request(app.getHttpServer())
      .post(`${url}/test`)
      .set("Authorization", "Bearer admin")
      .send({ slug: "andi-sari" });
    expect(res.status).toBe(200);
    expect(service.test).toHaveBeenCalledWith("andi-sari");
  });
});

describe("P5-13 authoritative blocklist cache", () => {
  it("cannot cache a concurrent intermediate list under a restored blocklist fingerprint", async () => {
    const restored = { id: ID, term: "bad", matchType: "substring" };
    const intermediate = { ...restored, term: "good" };
    const fingerprint = (row: typeof restored) =>
      createHash("sha256")
        .update(`${row.id}:${row.term}:${row.matchType}`)
        .digest("hex");
    const current = fingerprint(restored);
    // The first fingerprint sees A; the miss read sees B after an admin edit.
    // The admin then restores A and invalidates before this validator populates Redis.
    const from = vi
      .fn()
      .mockResolvedValueOnce([{ fingerprint: current }])
      .mockResolvedValueOnce([intermediate])
      .mockResolvedValueOnce([{ fingerprint: current }])
      .mockResolvedValueOnce([restored]);
    const db = { select: () => ({ from }) } as unknown as Database;
    const entries = new Map<string, unknown>();
    const cache = {
      getJson: vi.fn(async (_namespace: string, key: string) =>
        entries.get(key),
      ),
      setJson: vi.fn(
        async (_namespace: string, key: string, value: unknown) => {
          entries.set(key, value);
        },
      ),
    } as unknown as CachePort;
    const service = new SlugService(db, {} as InvitationRepository, cache);
    await service.findBlockingTerm("couple-b4d-day");
    await expect(service.findBlockingTerm("couple-b4d-day")).resolves.toBe(
      "bad",
    );
    expect(cache.setJson).toHaveBeenNthCalledWith(
      1,
      "slug-blocklist",
      fingerprint(intermediate),
      [{ term: "good", matchType: "substring" }],
      60,
    );
  });

  it("rejects an all-script reason after sanitization", () => {
    expect(
      slugBlocklistWriteSchema.safeParse({
        ...payload,
        reason: "<script>alert(1)</script>",
      }).success,
    ).toBe(false);
  });
  it("uses DB fingerprint so stale Redis data cannot approve a newly blocked slug", async () => {
    const from = vi
      .fn()
      .mockResolvedValueOnce([{ fingerprint: "new-version" }])
      .mockResolvedValueOnce([{ id: ID, term: "bad", matchType: "substring" }]);
    const db = { select: () => ({ from }) } as unknown as Database;
    const cache = {
      getJson: vi.fn().mockResolvedValue(undefined),
      setJson: vi.fn().mockResolvedValue(undefined),
    } as unknown as CachePort;
    const service = new SlugService(db, {} as InvitationRepository, cache);
    expect(await service.findBlockingTerm("couple-b4d-day")).toBe("bad");
    expect(cache.getJson).toHaveBeenCalledWith("slug-blocklist", "new-version");
  });
  it("uses only exact matches for reserved words and folds case for substring terms", async () => {
    const db = {
      select: () => ({
        from: vi.fn().mockResolvedValue([{ fingerprint: "current" }]),
      }),
    } as unknown as Database;
    const cache = {
      getJson: vi.fn().mockResolvedValue([
        { term: "app", matchType: "exact" },
        { term: "bad", matchType: "substring" },
      ]),
    } as unknown as CachePort;
    const service = new SlugService(db, {} as InvitationRepository, cache);
    expect(await service.findBlockingTerm("aprilia-budi")).toBeUndefined();
    expect(await service.findBlockingTerm("APP")).toBe("app");
    expect(await service.findBlockingTerm("couple-B4D-day")).toBe("bad");
  });
  it("does not approve a slug when authoritative DB read fails", async () => {
    const db = {
      select: () => ({ from: vi.fn().mockRejectedValue(new Error("DB down")) }),
    } as unknown as Database;
    await expect(
      new SlugService(
        db,
        {} as InvitationRepository,
        {} as CachePort,
      ).findBlockingTerm("anything"),
    ).rejects.toThrow("DB down");
  });
});
