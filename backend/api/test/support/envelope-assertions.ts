import { expect } from "vitest";
import type { Response } from "supertest";

/**
 * The shared envelope assertions. `P0-13` DoD: "asserted by a shared integration test
 * helper used across all later endpoint tests".
 *
 * Every endpoint test in Phases 1 to 5 should reach for these instead of writing its own
 * `expect(body.success).toBe(true)`. Not for brevity — so that when the envelope changes,
 * or when someone gets it subtly wrong, it changes or fails in **one** place rather than
 * in eighty tests that each encoded a slightly different idea of the contract.
 *
 * They assert the shape is exactly right, not merely compatible: an extra top-level key
 * is a contract violation too, and the check that only looks for the keys it expects is
 * the check that lets `{success, data, stack}` through.
 */

/** A successful response, with the documented shape and nothing else. */
export function expectSuccess<T = unknown>(res: Response, status = 200): T {
  expect(
    res.status,
    `expected ${status}, body was ${JSON.stringify(res.body)}`,
  ).toBe(status);
  expect(res.headers["content-type"]).toMatch(/application\/json/);

  expect(res.body).toHaveProperty("success", true);
  expect(res.body).toHaveProperty("data");
  // `success`, `data`, and optionally `meta`. Nothing else -- docs/API/00.
  expect(Object.keys(res.body).sort()).toEqual(
    res.body.meta === undefined
      ? ["data", "success"]
      : ["data", "meta", "success"],
  );

  return res.body.data as T;
}

/** A paginated response. Asserts `meta` matches `docs/API/00` exactly. */
export function expectPaginated<T = unknown>(
  res: Response,
  expected?: Partial<{ page: number; per_page: number; total: number }>,
): T[] {
  const data = expectSuccess<T[]>(res);
  expect(Array.isArray(data)).toBe(true);

  const meta = res.body.meta as Record<string, unknown>;
  expect(meta, "a paginated response must carry meta").toBeDefined();
  expect(Object.keys(meta).sort()).toEqual(["page", "per_page", "total"]);
  expect(typeof meta["page"]).toBe("number");
  expect(typeof meta["per_page"]).toBe("number");
  expect(typeof meta["total"]).toBe("number");

  if (expected !== undefined) expect(meta).toMatchObject(expected);

  return data;
}

/**
 * An error response.
 *
 * Also asserts the body leaks nothing internal — `docs/SECURITY/08` § Error Handling.
 * Doing that here rather than in one dedicated test means every endpoint test in the
 * project checks it for free, on whatever error it happened to produce.
 */
export function expectError(
  res: Response,
  status: number,
  code?: string,
): {
  code: string;
  message: string;
  details?: { field: string; message: string }[];
} {
  expect(
    res.status,
    `expected ${status}, body was ${JSON.stringify(res.body)}`,
  ).toBe(status);

  expect(res.body).toHaveProperty("success", false);
  expect(Object.keys(res.body).sort()).toEqual(["error", "success"]);

  const error = res.body.error as Record<string, unknown>;
  expect(typeof error["code"]).toBe("string");
  expect(typeof error["message"]).toBe("string");
  expect(
    Object.keys(error).every((k) => ["code", "message", "details"].includes(k)),
  ).toBe(true);

  if (code !== undefined) expect(error["code"]).toBe(code);

  expectNoInternalLeak(res);

  return error as {
    code: string;
    message: string;
    details?: { field: string; message: string }[];
  };
}

/**
 * Nothing in the body may identify the implementation.
 *
 * The patterns are the things that actually turn up in an unfiltered error: a stack
 * frame, a filesystem path, a SQL fragment, a driver's error code, a port number. Each
 * one either tells an attacker what to attack or tells them where it lives.
 */
export function expectNoInternalLeak(res: Response): void {
  const body = JSON.stringify(res.body);

  const forbidden: Array<[RegExp, string]> = [
    [/\bat\s+\w+\s+\(/, "a stack frame"],
    [/\.ts:\d+|\.js:\d+/, "a source location"],
    [/[A-Za-z]:\\\\|\/(?:home|usr|var|app|Users)\//, "a filesystem path"],
    [/\bnode_modules\b/, "a dependency path"],
    [/\bSELECT\b|\bINSERT\b|\bUPDATE\s+\w+\s+SET\b|\brelation\s+"/i, "SQL"],
    [
      /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b/,
      "a network error code",
    ],
    [/\bpostgres|\bpg_|\bdrizzle\b|\bpino\b/i, "an internal component name"],
    [/:\d{4,5}\b/, "a port number"],
  ];

  for (const [pattern, what] of forbidden) {
    expect(body, `error body leaked ${what}: ${body}`).not.toMatch(pattern);
  }
}
