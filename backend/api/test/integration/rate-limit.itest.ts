import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Redis as IORedis } from "ioredis";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { RATE_LIMIT_REDIS } from "../../src/shared/rate-limit/rate-limiter";

import {
  RateLimiter,
  RateLimiterUnavailableError,
} from "../../src/shared/rate-limit/rate-limiter";
import {
  PolicyRegistry,
  CONFIG_HASH_KEY,
} from "../../src/shared/rate-limit/config";
import {
  blockDurationSeconds,
  BLOCK_BASE_SECONDS,
  BLOCK_MAX_SECONDS,
  DEFAULT_POLICIES,
  isExemptPath,
  type RateLimitPolicy,
} from "../../src/shared/rate-limit/policies";

/**
 * P1-07 — the limiter, against a real Redis.
 *
 * Against a real one on purpose. The whole mechanism is a Lua script and a sorted set;
 * mocking Redis would test the mock's arithmetic, and the two properties that matter most
 * — that the window slides, and that concurrent checks cannot both pass the last slot —
 * are properties of Redis executing the script, not of this file's logic.
 */

const REDIS_URL =
  process.env["TEST_REDIS_URL"] ??
  process.env["REDIS_URL"] ??
  "redis://localhost:56379";

const policy = (over: Partial<RateLimitPolicy> = {}): RateLimitPolicy => ({
  name: `test-${Math.random().toString(36).slice(2, 8)}`,
  limit: 3,
  windowSeconds: 2,
  key: "ip",
  ...over,
});

describe("rate limiting", () => {
  let redis: IORedis;
  let limiter: RateLimiter;

  beforeAll(async () => {
    redis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    // Fail rather than skip, for the same reason the database suites do: a skipped
    // limiter suite reports green for a control nobody exercised.
    await redis.ping();
    limiter = new RateLimiter(redis);
  }, 30_000);

  afterAll(async () => {
    await redis.quit().catch(() => redis.disconnect());
  });

  afterEach(async () => {
    const keys = await redis.keys("rl:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  describe("the window", () => {
    it("allows exactly the limit, then refuses", async () => {
      const p = policy({ limit: 3 });

      for (let i = 0; i < 3; i += 1) {
        const d = await limiter.check(p, "1.2.3.4");
        expect(d.allowed, `attempt ${i + 1} should be allowed`).toBe(true);
        expect(d.remaining).toBe(2 - i);
      }

      const refused = await limiter.check(p, "1.2.3.4");
      expect(refused.allowed).toBe(false);
      expect(refused.remaining).toBe(0);
    });

    it("frees a slot once the window passes", async () => {
      const p = policy({ limit: 2, windowSeconds: 1 });

      await limiter.check(p, "1.2.3.4");
      await limiter.check(p, "1.2.3.4");
      expect((await limiter.check(p, "1.2.3.4")).allowed).toBe(false);

      await new Promise((r) => setTimeout(r, 1100));
      expect((await limiter.check(p, "1.2.3.4")).allowed).toBe(true);
    });

    it("a fixed-window burst does not get double the allowance", async () => {
      // THE reason this is a sliding window. Under a fixed window an attacker spends the
      // allowance at the end of one window and again at the start of the next -- 2x the
      // limit across two seconds. Here the second burst sees the first still inside the
      // window.
      const p = policy({ limit: 3, windowSeconds: 2 });

      for (let i = 0; i < 3; i += 1) await limiter.check(p, "1.2.3.4");

      // Most of the way through the window, but not past it.
      await new Promise((r) => setTimeout(r, 1200));

      const d = await limiter.check(p, "1.2.3.4");
      expect(
        d.allowed,
        "a sliding window must still count the earlier burst",
      ).toBe(false);
    });

    it("concurrent checks cannot both take the last slot", async () => {
      // The reason the trim, the count and the add are one Lua script. As three round
      // trips both callers read 2, both decide they are under a limit of 3, and 4 get in.
      const p = policy({ limit: 3, windowSeconds: 10 });
      await limiter.check(p, "1.2.3.4");
      await limiter.check(p, "1.2.3.4");

      const results = await Promise.all([
        limiter.check(p, "1.2.3.4"),
        limiter.check(p, "1.2.3.4"),
        limiter.check(p, "1.2.3.4"),
      ]);

      expect(results.filter((r) => r.allowed)).toHaveLength(1);
    });

    it("reports a reset time in the future when the window is full", async () => {
      const p = policy({ limit: 1, windowSeconds: 60 });
      await limiter.check(p, "1.2.3.4");

      const d = await limiter.check(p, "1.2.3.4");
      expect(d.resetAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(d.retryAfterSeconds).toBeGreaterThan(0);
      expect(d.retryAfterSeconds).toBeLessThanOrEqual(60);
    });
  });

  describe("keys are separate buckets", () => {
    it("two addresses do not share a budget", async () => {
      const p = policy({ limit: 1 });

      expect((await limiter.check(p, "1.1.1.1")).allowed).toBe(true);
      expect((await limiter.check(p, "2.2.2.2")).allowed).toBe(true);
      expect((await limiter.check(p, "1.1.1.1")).allowed).toBe(false);
    });

    it("two policies do not share a budget", async () => {
      const a = policy({ limit: 1 });
      const b = policy({ limit: 1 });

      expect((await limiter.check(a, "1.1.1.1")).allowed).toBe(true);
      expect((await limiter.check(b, "1.1.1.1")).allowed).toBe(true);
    });
  });

  describe("only failures count, where the document says so", () => {
    it("a successful login does not consume the failure budget", async () => {
      // docs/SECURITY/10: "5 FAILED attempts". Counting successes would lock out a
      // household sharing an address, and would let an attacker exhaust a victim's
      // budget by logging in correctly.
      const p = policy({ limit: 2, onFailureOnly: true, windowSeconds: 60 });

      // Ten checks, no failures recorded.
      for (let i = 0; i < 10; i += 1) {
        expect((await limiter.check(p, "a@x|1.1.1.1")).allowed).toBe(true);
      }
    });

    it("recorded failures do consume it", async () => {
      const p = policy({ limit: 2, onFailureOnly: true, windowSeconds: 60 });

      await limiter.recordFailure(p, "a@x|1.1.1.1");
      await limiter.recordFailure(p, "a@x|1.1.1.1");

      expect((await limiter.check(p, "a@x|1.1.1.1")).allowed).toBe(false);
    });

    it("another account's failures do not lock this one out", async () => {
      const p = policy({ limit: 1, onFailureOnly: true, windowSeconds: 60 });

      await limiter.recordFailure(p, "victim@x|1.1.1.1");
      expect((await limiter.check(p, "other@x|1.1.1.1")).allowed).toBe(true);
    });
  });

  describe("escalating blocks (docs/SECURITY/10 § Monitoring & Auto-block)", () => {
    it("a repeat violator is blocked for longer each time", async () => {
      const p = policy();

      expect(await limiter.block(p, "1.1.1.1")).toBe(BLOCK_BASE_SECONDS);
      await redis.del(`rl:block:${p.name}:1.1.1.1`);
      expect(await limiter.block(p, "1.1.1.1")).toBe(BLOCK_BASE_SECONDS * 2);
      await redis.del(`rl:block:${p.name}:1.1.1.1`);
      expect(await limiter.block(p, "1.1.1.1")).toBe(BLOCK_BASE_SECONDS * 4);
    });

    it("the escalation is capped", async () => {
      // Past a day it should be a person looking at it, not an algorithm.
      expect(blockDurationSeconds(20)).toBe(BLOCK_MAX_SECONDS);
      expect(blockDurationSeconds(1)).toBe(BLOCK_BASE_SECONDS);
    });

    it("a block refuses even an otherwise-empty window", async () => {
      const p = policy({ limit: 100, windowSeconds: 60 });
      await limiter.block(p, "1.1.1.1");

      const d = await limiter.check(p, "1.1.1.1");
      expect(d.allowed).toBe(false);
      expect(d.blocked).toBe(true);
      expect(d.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("a block is per key, not global", async () => {
      const p = policy({ limit: 100 });
      await limiter.block(p, "1.1.1.1");

      expect((await limiter.check(p, "2.2.2.2")).allowed).toBe(true);
    });

    it("strikes accumulate and are readable", async () => {
      const p = policy();
      await limiter.block(p, "1.1.1.1");
      await limiter.block(p, "1.1.1.1");

      expect(await limiter.strikes(p, "1.1.1.1")).toBe(2);
    });
  });

  describe("configuration (DoD item 2)", () => {
    it("matches docs/SECURITY/10's table by default", async () => {
      const registry = new PolicyRegistry(undefined, undefined);
      const byName = new Map(registry.all().map((p) => [p.name, p]));

      // The document's table, row for row.
      expect(byName.get("login")).toMatchObject({
        limit: 5,
        windowSeconds: 900,
        key: "email+ip",
      });
      expect(byName.get("register")).toMatchObject({
        limit: 5,
        windowSeconds: 3600,
        key: "ip",
      });
      expect(byName.get("forgot-password")).toMatchObject({
        limit: 3,
        windowSeconds: 3600,
        key: "email+ip",
      });
      expect(byName.get("rsvp")).toMatchObject({
        limit: 10,
        key: "iphash+slug",
      });
      expect(byName.get("guestbook")).toMatchObject({ limit: 10 });
      expect(byName.get("invitation-create")).toMatchObject({
        limit: 10,
        windowSeconds: 86400,
        key: "user",
      });
      expect(byName.get("media-upload")).toMatchObject({
        limit: 60,
        key: "user",
      });
      expect(byName.get("general-authenticated")).toMatchObject({
        limit: 300,
        windowSeconds: 60,
      });
      expect(byName.get("general-public")).toMatchObject({
        limit: 100,
        windowSeconds: 60,
      });
    });

    it("an environment override applies", async () => {
      const registry = new PolicyRegistry(
        undefined,
        JSON.stringify({ login: { limit: 20 } }),
      );
      expect(registry.get("login").limit).toBe(20);
      // Untouched fields keep the document's values.
      expect(registry.get("login").windowSeconds).toBe(900);
    });

    it("a Redis override applies with no restart (the DoD's 'without a deploy')", async () => {
      await redis.hset(CONFIG_HASH_KEY, "login", JSON.stringify({ limit: 42 }));

      const registry = new PolicyRegistry(redis, undefined);
      expect(registry.get("login").limit).toBe(5); // before the first refresh
      await registry.refresh();
      expect(registry.get("login").limit).toBe(42);

      await redis.del(CONFIG_HASH_KEY);
    });

    it("Redis beats the environment", async () => {
      await redis.hset(CONFIG_HASH_KEY, "login", JSON.stringify({ limit: 7 }));

      const registry = new PolicyRegistry(
        redis,
        JSON.stringify({ login: { limit: 20 } }),
      );
      await registry.refresh();
      expect(registry.get("login").limit).toBe(7);

      await redis.del(CONFIG_HASH_KEY);
    });

    it.each([
      ["not JSON", "{{{"],
      ["a negative limit", '{"limit":-1}'],
      ["a zero limit", '{"limit":0}'],
      ["a string limit", '{"limit":"lots"}'],
      ["an unrelated object", '{"colour":"blue"}'],
    ])("a malformed override (%s) is ignored, not applied", async (_n, raw) => {
      // A typo during a tuning change must not remove a security control -- least of all
      // at the moment somebody is distracted by traffic.
      await redis.hset(CONFIG_HASH_KEY, "login", raw);

      const registry = new PolicyRegistry(redis, undefined);
      await registry.refresh();
      expect(registry.get("login").limit).toBe(5);

      await redis.del(CONFIG_HASH_KEY);
    });

    it("an unknown policy name throws rather than defaulting to unlimited", async () => {
      const registry = new PolicyRegistry(undefined, undefined);
      expect(() => registry.get("no-such-policy")).toThrow(
        /Unknown rate limit/,
      );
    });
  });

  describe("when Redis is down (ADR-050, DoD item 4)", () => {
    let broken: RateLimiter;

    beforeAll(() => {
      const dead = new IORedis("redis://127.0.0.1:1", {
        maxRetriesPerRequest: 1,
        connectTimeout: 200,
        commandTimeout: 200,
        lazyConnect: true,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });
      dead.on("error", () => {});
      broken = new RateLimiter(dead);
    });

    it("login fails closed", async () => {
      // Unlimited credential attempts against a live user table is a credential-stuffing
      // window. A login outage is an outage; an unlimited login endpoint is a breach.
      const p = policy({ failClosed: true });

      await expect(broken.check(p, "1.1.1.1")).rejects.toBeInstanceOf(
        RateLimiterUnavailableError,
      );
    });

    it("general traffic fails open", async () => {
      // Throttling protects capacity. Refusing every request because the LIMITER is down
      // converts a degraded dependency into a total outage.
      const p = policy({ failClosed: false });

      const d = await broken.check(p, "1.1.1.1");
      expect(d.allowed).toBe(true);
      expect(d.remaining).toBe(p.limit);
    });

    it("every credential policy is fail-closed and nothing else is", async () => {
      // The split itself, asserted rather than described. A new policy added to the
      // credential group without `failClosed` would be caught here.
      const closed = DEFAULT_POLICIES.filter((p) => p.failClosed === true).map(
        (p) => p.name,
      );
      expect(closed.sort()).toEqual([
        "forgot-password",
        "login",
        "register",
        "reset-password",
      ]);
    });

    it("recordFailure never throws, even fully broken", async () => {
      // The caller has already been told their password was wrong. A Redis blip must not
      // turn that into a 500.
      const p = policy({ failClosed: true, onFailureOnly: true });
      await expect(broken.recordFailure(p, "1.1.1.1")).resolves.toBeUndefined();
    });

    it("block reports 0 rather than pretending", async () => {
      const p = policy();
      expect(await broken.block(p, "1.1.1.1")).toBe(0);
    });
  });

  describe("exempt paths (DoD item 3)", () => {
    it("the payment webhook is never rate limited", async () => {
      // docs/SECURITY/02 boundary 5. A provider retry storm is legitimate traffic, and
      // throttling it into failure loses a payment notification -- which
      // docs/SECURITY/07 makes the only source of truth for payment status.
      expect(isExemptPath("/api/v1/webhooks/midtrans")).toBe(true);
      expect(isExemptPath("/api/v1/webhooks/anything/else")).toBe(true);
    });

    it("health checks are exempt", async () => {
      // An orchestrator probing from one address would otherwise consume the public
      // budget and take the service out by declaring it unhealthy.
      expect(isExemptPath("/health")).toBe(true);
      expect(isExemptPath("/readyz")).toBe(true);
    });

    it("nothing else is exempt", async () => {
      expect(isExemptPath("/api/v1/auth/login")).toBe(false);
      expect(isExemptPath("/api/v1/invitations")).toBe(false);
      // Not a prefix match on a crafted path.
      expect(isExemptPath("/api/v1/invitations/webhooks/x")).toBe(false);
    });
  });

  /**
   * The cold start. Found on the first Phase 1 staging deploy, not by any test here.
   *
   * `POST /auth/register` answered 503 against a Redis that was healthy and reachable
   * from the API container; the same call a minute later answered 201. The limiter had
   * failed closed -- correctly, by ADR-050 -- on a client that had never connected.
   *
   * Every test above constructs its client WITHOUT `lazyConnect` and calls `ping()` in
   * `beforeAll`, so the suite was structurally unable to see this. That is the lesson
   * worth keeping: the harness had already done the thing production had not.
   */
  describe("the first command after a cold start", () => {
    const productionOptions = {
      // Exactly what `rate-limit.module.ts` builds.
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      commandTimeout: 1000,
      lazyConnect: true,
      enableOfflineQueue: false,
    } as const;

    it("is rejected outright when nothing connected first", async () => {
      // The hazard itself, asserted rather than described. If a future change to the
      // client options makes this pass, the guard below has stopped being necessary --
      // and this test says so instead of silently protecting nothing.
      const cold = new IORedis(REDIS_URL, productionOptions);

      await expect(cold.get("rl:cold-start-probe")).rejects.toThrow();

      await cold.quit().catch(() => cold.disconnect());
    });

    it("succeeds when the module connected at startup", async () => {
      const warm = new IORedis(REDIS_URL, productionOptions);

      // What RateLimitModule.onModuleInit does, and the whole of the fix.
      expect(warm.status).toBe("wait");
      await warm.connect();

      await expect(warm.get("rl:cold-start-probe")).resolves.toBeNull();

      await warm.quit().catch(() => warm.disconnect());
    });

    it("a limiter on a connected client answers its first check", async () => {
      // The property the endpoint actually depends on: not "a command works" but "the
      // first `check` after boot reaches a decision instead of raising unavailable".
      const warm = new IORedis(REDIS_URL, productionOptions);
      await warm.connect();

      const cold = new RateLimiter(warm);
      const verdict = await cold.check(
        policy({ name: "cold-start" }),
        "1.2.3.4",
      );

      expect(verdict.allowed).toBe(true);

      await warm.quit().catch(() => warm.disconnect());
    });
  });

  /**
   * And that the module actually does it.
   *
   * The three tests above prove the hazard is real and that `connect()` removes it. None
   * of them would fail if `RateLimitModule.onModuleInit` were deleted -- they build their
   * own clients. This one boots the real application and asks the container for the very
   * client the guard will use, which is the only version that catches a regression.
   */
  describe("the application connects its limiter before serving", () => {
    let app: INestApplication;

    beforeAll(async () => {
      process.env["DATABASE_URL"] = (
        process.env["MIGRATION_DATABASE_URL"] ??
        "postgres://wedding_owner:wedding_owner_dev@localhost:55432/wedding"
      ).replace(/\/\/[^@]+@/, "//wedding_app:wedding_app_dev@");
      process.env["REDIS_URL"] = REDIS_URL;
      process.env["JWT_SIGNING_KEY"] =
        "cold-start-signing-key-0000000000000000";

      const { AppModule } = await import("../../src/app.module.ts");
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
    }, 60_000);

    afterAll(async () => {
      await app?.close();
    });

    it("hands the guard a client that is already ready", () => {
      const redis = app.get<IORedis>(RATE_LIMIT_REDIS);

      // `wait` here is the bug: lazy, never connected, and the next command fails.
      expect(redis.status).toBe("ready");
    });

    it("answers the FIRST request to a credential endpoint, rather than 503", async () => {
      // The symptom exactly as staging produced it. A 400 is a fine outcome -- the body
      // is deliberately incomplete -- and 503 is not: that is the limiter refusing
      // because it could not reach a Redis that is right there.
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/register")
        .send({ email: "cold-start@example.test" });

      expect(response.status).not.toBe(503);
    });
  });
});
