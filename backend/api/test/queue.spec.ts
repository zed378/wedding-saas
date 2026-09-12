import { describe, expect, it, vi, beforeEach } from "vitest";
import { Queue } from "bullmq";

import { JOB_QUEUE, QueueModule } from "../src/infra/queue/queue.module";

/**
 * P1-18 — the producer's half of the queue contract.
 *
 * Until `P1-18` this side added jobs to a queue named after the **pool** while
 * `JobRunner` in the worker created one `new Worker(jobName)` per job. Every job the API
 * ever enqueued therefore landed in a queue nobody consumed, and nothing noticed because no
 * handler had been registered — `P1-02`'s eight `notification.send` calls had been going
 * nowhere for six tasks.
 *
 * Two facts hold the halves together:
 *
 *   **the queue name is the job name**;
 *   **the payload is the `JobEnvelope`**, with the caller's data under `data`.
 *
 * This file pins the producer's half. `queue.itest.ts` in the worker pins the consumer's,
 * against a real Redis. Neither can see the other — the API cannot import `@wi/worker` — so
 * the pair is what stands in for a shared type until the shape moves into a package.
 */

const added: { queue: string; name: string; payload: unknown }[] = [];
const constructed: string[] = [];

vi.mock("bullmq", () => ({
  Queue: class {
    constructor(public readonly name: string) {
      constructed.push(name);
    }
    async add(name: string, payload: unknown): Promise<void> {
      added.push({ queue: this.name, name, payload });
    }
    async close(): Promise<void> {}
  },
}));

vi.mock("ioredis", () => ({
  Redis: class {
    disconnect(): void {}
  },
}));

interface Producer {
  enqueue: (
    pool: string,
    name: string,
    data: Record<string, unknown>,
    options?: { idempotencyKey?: string; relatedId?: string },
  ) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Build the producer from the module's own provider factory.
 *
 * Reaching it through the metadata rather than standing up a Nest container: the thing
 * under test is twenty lines of wiring, and a container would add a second reason for this
 * file to fail.
 */
const loadFactory = (): Producer => {
  const metadata = Reflect.getMetadata("providers", QueueModule) as {
    provide: symbol;
    useFactory: (env: unknown) => unknown;
  }[];

  const provider = metadata.find((p) => p.provide === JOB_QUEUE)!;
  return provider.useFactory({
    REDIS_URL: "redis://localhost:6379",
  }) as Producer;
};

describe("the job producer", () => {
  beforeEach(() => {
    added.length = 0;
    constructed.length = 0;
  });

  it("addresses the queue by JOB NAME, not by pool", async () => {
    const queue = loadFactory();

    await queue.enqueue("media", "media.process", { mediaId: "abc" });

    expect(constructed).toEqual(["media.process"]);
    expect(added[0]!.queue).toBe("media.process");
    // The pool is still passed, and it is still real -- docs/BACKEND/08 separates
    // worker-media from worker-general so they scale and fail independently. It is a
    // property of the worker PROCESS, decided by jobs.ts, not an address.
    expect(added[0]!.queue).not.toBe("media");
  });

  it("wraps the caller's data in the envelope the worker unwraps", async () => {
    const queue = loadFactory();

    await queue.enqueue(
      "media",
      "media.process",
      { mediaId: "abc" },
      { idempotencyKey: "media.process:abc", relatedId: "invitation-1" },
    );

    const payload = added[0]!.payload as Record<string, unknown>;
    expect(payload["data"]).toEqual({ mediaId: "abc" });
    expect(payload["idempotencyKey"]).toBe("media.process:abc");
    expect(payload["relatedId"]).toBe("invitation-1");
    expect(payload["trace"]).toMatchObject({
      enqueued_at: expect.any(String) as unknown as string,
    });
  });

  it("omits an idempotency key rather than sending undefined", async () => {
    // The worker treats an absent key as "inherently safe to repeat" and a present one as a
    // claim to take. A literal `undefined` under the key would serialise to JSON as an
    // absent field anyway -- but only by accident, and the next serialiser might differ.
    const queue = loadFactory();

    await queue.enqueue("general", "notification.send", { template: "x" });

    const payload = added[0]!.payload as Record<string, unknown>;
    expect("idempotencyKey" in payload).toBe(false);
    expect("relatedId" in payload).toBe(false);
  });

  it("reuses one Queue per job name", async () => {
    const queue = loadFactory();

    await queue.enqueue("general", "notification.send", { template: "a" });
    await queue.enqueue("general", "notification.send", { template: "b" });
    await queue.enqueue("media", "media.process", { mediaId: "c" });

    expect(constructed).toEqual(["notification.send", "media.process"]);
  });

  it("swallows an enqueue failure rather than failing the request", async () => {
    // P0-15's deliberate design, restated as a test because P1-18 changed the code around
    // it: the caller's transaction has already committed, and rolling back a registration
    // because Redis blinked is a worse outcome than a missing email.
    const queue = loadFactory();

    const original = Queue.prototype.add;
    Queue.prototype.add = async () => {
      throw new Error("redis unreachable");
    };

    try {
      await expect(
        queue.enqueue("general", "notification.send", { template: "x" }),
      ).resolves.toBeUndefined();
    } finally {
      Queue.prototype.add = original;
    }
  });
});
