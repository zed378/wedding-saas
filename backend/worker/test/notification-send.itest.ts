import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Redis } from "ioredis";
import { Queue } from "bullmq";
import type { Pool as PgPool } from "pg";

import {
  JobRunner,
  DLQ_NAME,
  deadLetterDepth,
  type JobPayload,
} from "../src/runner.js";
import { policyFor } from "../src/jobs.js";
import { makeNotificationSendHandler } from "../src/handlers/notification-send.handler.js";
import { MemoryEmailAdapter } from "../src/email/index.js";
import type { WorkerEnv } from "../src/env.js";

const REDIS_URL = process.env["TEST_REDIS_URL"] ?? process.env["REDIS_URL"] ?? "redis://localhost:6379";
const TEST_DB = 9;

let redis: Redis;
let connection: { url: string };

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function until(
  check: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for: ${what}`);
}

describe("notification.send integration (P4-06)", () => {
  let skipAll = false;

  beforeAll(async () => {
    try {
      const url = new URL(REDIS_URL);
      url.pathname = `/${TEST_DB}`;
      connection = { url: url.toString() };

      redis = new Redis(connection.url, { maxRetriesPerRequest: null });
      await redis.ping();
    } catch {
      skipAll = true;
    }
  });

  afterAll(async () => {
    if (redis) {
      await redis.quit();
    }
  });

  beforeEach(async () => {
    if (skipAll || !redis) return;
    await redis.flushdb();
  });

  it("processes notification.send job from BullMQ queue to MemoryEmailAdapter", async () => {
    if (skipAll) {
      console.warn("Redis not running; skipping live integration test");
      return;
    }

    const memoryEmail = new MemoryEmailAdapter();
    const mockPg = {
      query: async (sql: string) => {
        if (sql.includes("FROM users")) {
          return {
            rows: [{ email: "test-user@example.com", full_name: "Test User" }],
          };
        }
        return { rows: [] };
      },
    } as unknown as PgPool;

    const mockEnv: WorkerEnv = {
      appEnv: "test",
      redisUrl: connection.url,
      databaseUrl: "",
      appOrigin: "https://momenbahagia.id",
      publicInviteOrigin: "https://undangan.momenbahagia.id",
      email: { from: "Momen Bahagia <halo@momenbahagia.id>" },
      storage: {
        endpoint: "",
        accessKeyId: "",
        secretAccessKey: "",
        buckets: { "user-media": "", "template-assets": "", staging: "" },
      },
      clamav: undefined,
    };

    const runner = new JobRunner({ pool: "general", connection, redis });
    const handler = makeNotificationSendHandler({
      pg: mockPg,
      emailPort: memoryEmail,
      env: mockEnv,
    });

    runner.register("notification.send", handler as never);
    runner.start();

    try {
      const queue = new Queue("notification.send", { connection });
      const policy = policyFor("notification.send");

      await queue.add(
        "notification.send",
        {
          data: {
            template: "email_verification",
            userId: "u-123",
            token: "tok-abc",
          },
        } satisfies JobPayload,
        {
          attempts: policy.attempts,
          backoff: policy.backoff,
        },
      );

      await until(
        () => memoryEmail.getSent().length >= 1,
        "email to be received by MemoryEmailAdapter",
      );

      const sent = memoryEmail.getSent();
      expect(sent).toHaveLength(1);
      const first = sent[0]!;
      expect(first.to).toBe("test-user@example.com");
      expect(first.subject).toContain("Verifikasi");
      expect(first.html).toContain("tok-abc");

      await queue.close();
    } finally {
      await runner.stop();
    }
  });
});
