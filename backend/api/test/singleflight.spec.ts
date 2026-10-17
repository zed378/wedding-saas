import { describe, expect, it, vi } from "vitest";

import { Singleflight } from "../src/shared/utils/singleflight";

describe("Singleflight", () => {
  it("deduplicates concurrent executions for the same key", async () => {
    const sf = new Singleflight();
    let invocations = 0;

    const task = async () => {
      invocations++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "result-1";
    };

    const results = await Promise.all(
      Array.from({ length: 100 }, () => sf.do("key-1", task)),
    );

    expect(invocations).toBe(1);
    expect(results).toHaveLength(100);
    expect(results.every((r) => r === "result-1")).toBe(true);
    expect(sf.activeCount()).toBe(0);
  });

  it("runs different keys independently", async () => {
    const sf = new Singleflight();
    let countA = 0;
    let countB = 0;

    const [resA, resB] = await Promise.all([
      sf.do("a", async () => {
        countA++;
        return "val-a";
      }),
      sf.do("b", async () => {
        countB++;
        return "val-b";
      }),
    ]);

    expect(countA).toBe(1);
    expect(countB).toBe(1);
    expect(resA).toBe("val-a");
    expect(resB).toBe("val-b");
  });

  it("runs again after the previous call has completed", async () => {
    const sf = new Singleflight();
    let invocations = 0;

    const task = async () => {
      invocations++;
      return `run-${invocations}`;
    };

    const first = await sf.do("k", task);
    const second = await sf.do("k", task);

    expect(invocations).toBe(2);
    expect(first).toBe("run-1");
    expect(second).toBe("run-2");
  });

  it("propagates errors to all concurrent callers and cleans up inFlight map", async () => {
    const sf = new Singleflight();
    let invocations = 0;

    const failingTask = async () => {
      invocations++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error("boom");
    };

    const promises = Array.from({ length: 10 }, () =>
      sf.do("err-key", failingTask),
    );

    for (const p of promises) {
      await expect(p).rejects.toThrow("boom");
    }

    expect(invocations).toBe(1);
    expect(sf.activeCount()).toBe(0);

    // After failure, a new call succeeds if fn succeeds
    const recovered = await sf.do("err-key", async () => "ok");
    expect(recovered).toBe("ok");
  });
});
