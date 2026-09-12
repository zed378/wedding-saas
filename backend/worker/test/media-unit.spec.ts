import { describe, expect, it } from "vitest";

import { interpret, ScannerUnavailableError } from "../src/media/clamav.js";
import { loadWorkerEnv, WorkerConfigError } from "../src/env.js";
import { MAX_DIMENSION, VARIANT_PLAN } from "../src/media/process-image.js";

/**
 * P1-18 — the parts that can be tested without a container.
 *
 * The clamd protocol's three replies are three strings, and a test that had to start
 * ClamAV to check them is a test nobody runs. The environment rules are the security
 * decision in this task that has no image in it at all.
 */

describe("clamd replies (docs/SECURITY/06 layer 10)", () => {
  it("reads a clean verdict", () => {
    expect(interpret("stream: OK\0")).toEqual({ verdict: "clean" });
  });

  it("reads an infection and keeps the signature name", () => {
    // The signature is the one detail an operator needs, and it describes the malware
    // rather than the customer.
    expect(interpret("stream: Eicar-Test-Signature FOUND\0")).toEqual({
      verdict: "infected",
      signature: "Eicar-Test-Signature",
    });
  });

  it.each([
    ["a size-limit error", "INSTREAM size limit exceeded. ERROR\0"],
    ["an empty reply", ""],
    ["a truncated reply", "stream:"],
    ["something else entirely", "UNKNOWN COMMAND\0"],
  ])("refuses to call %s clean", (_name, reply) => {
    // NOT clean. A scanner that said something this code does not understand has not said
    // the file is safe -- docs/SECURITY/00 fails closed on anything security-relevant.
    expect(() => interpret(reply)).toThrow(ScannerUnavailableError);
  });

  it("the unavailable error never carries a verdict", () => {
    // Guards the distinction the handler acts on: unavailable is retried, infected is not.
    // A ScannerUnavailableError that could be mistaken for a verdict would collapse the two.
    const error = new ScannerUnavailableError("connection refused");
    expect(error).not.toHaveProperty("verdict");
    expect(error.message).toContain("unavailable");
  });
});

describe("the variant plan", () => {
  it("is thumbnail, medium and large — three files, not four", () => {
    // OQ-19, closed by ADR-055. docs/ARCHITECTURE/05 lists `original | large | thumbnail`
    // and docs/BACKEND/04 lists `thumbnail | medium | large`; docs/PLAN/11 resolves it in
    // its own words -- "the retained *original* is the capped original from the processing
    // pipeline" -- which is `large`. The raw upload is never retained (BR-8.2).
    expect(VARIANT_PLAN.map((v) => v.variant)).toEqual([
      "thumbnail",
      "medium",
      "large",
    ]);
    expect(VARIANT_PLAN.map((v) => v.width)).toEqual([300, 800, 1600]);
  });

  it("caps dimensions where docs/SECURITY/06 layer 5 says to", () => {
    expect(MAX_DIMENSION).toBe(10_000);
  });
});

describe("the worker environment", () => {
  const base = {
    REDIS_URL: "redis://localhost:6379",
    DATABASE_URL: "postgres://app:pw@localhost:5432/wedding",
    STORAGE_ENDPOINT: "http://localhost:9000",
    STORAGE_ACCESS_KEY_ID: "key",
    STORAGE_SECRET_ACCESS_KEY: "secret",
  };

  it("a media worker with no scanner refuses to start", () => {
    // The security decision of this file. A worker that quietly published unscanned files
    // is indistinguishable from a working one until it matters.
    expect(() => loadWorkerEnv("media", { ...base })).toThrow(
      WorkerConfigError,
    );
  });

  it("names the escape hatch in the refusal, so nobody has to guess", () => {
    let message = "";
    try {
      loadWorkerEnv("media", { ...base });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("CLAMAV_HOST");
    expect(message).toContain("MEDIA_SCAN_DISABLED");
  });

  it("accepts a configured scanner", () => {
    const env = loadWorkerEnv("media", {
      ...base,
      CLAMAV_HOST: "clamav",
      CLAMAV_PORT: "3310",
    });
    expect(env.clamav).toEqual({ host: "clamav", port: 3310 });
  });

  it("allows the scan to be disabled in development", () => {
    const env = loadWorkerEnv("media", {
      ...base,
      MEDIA_SCAN_DISABLED: "true",
      APP_ENV: "development",
    });
    expect(env.clamav).toBeUndefined();
  });

  it.each(["staging", "production"])(
    "refuses MEDIA_SCAN_DISABLED in %s",
    (appEnv) => {
      // A skipped scan has to be something somebody chose in an environment where it is
      // survivable, never an environment variable that travelled to production with a
      // deploy script.
      expect(() =>
        loadWorkerEnv("media", {
          ...base,
          MEDIA_SCAN_DISABLED: "true",
          CLAMAV_HOST: "clamav",
          APP_ENV: appEnv,
        }),
      ).toThrow(/must not be set in/);
    },
  );

  it("names every problem at once, not the first", () => {
    let message = "";
    try {
      loadWorkerEnv("media", { REDIS_URL: "redis://localhost:6379" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("STORAGE_ENDPOINT");
    expect(message).toContain("STORAGE_ACCESS_KEY_ID");
  });

  it("asks the general pool for nothing but Redis", () => {
    // An email worker has no use for bucket credentials, and demanding them is the kind of
    // over-strict validation somebody loosens in a hurry -- for every pool at once.
    const env = loadWorkerEnv("general", {
      REDIS_URL: "redis://localhost:6379",
    });
    expect(env.redisUrl).toBe("redis://localhost:6379");
    expect(env.clamav).toBeUndefined();
  });

  it("asks the cron pool for a database and a bucket, because the sweep needs both", () => {
    expect(() =>
      loadWorkerEnv("cron", { REDIS_URL: "redis://localhost:6379" }),
    ).toThrow(/DATABASE_URL/);
  });
});
