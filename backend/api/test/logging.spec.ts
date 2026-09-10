import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pino from "pino";
import { Writable } from "node:stream";

import {
  redact,
  maskTail,
  maskEmail,
  REDACTED,
  REDACTED_KEY_NAMES,
  MASKED_KEY_NAMES,
  EMAIL_KEY_NAMES,
} from "../src/shared/logging/redact";
import {
  runWithRequestContext,
  currentRequestContext,
  enrichRequestContext,
} from "../src/shared/logging/request-context";
import {
  enqueueEnvelope,
  runJobWithTrace,
  type JobEnvelope,
} from "../src/shared/logging/job-context";
import { logger, securityLogger } from "../src/shared/logging/logger";

/**
 * P0-12 — redaction, tested by trying to leak.
 *
 * `docs/DEVOPS/06` § Mandatory Redaction says this must happen "at the logger middleware
 * level, not relying on manual developer discipline each time". The DoD asks for a test
 * that logs an object containing every sensitive key name and asserts none of the values
 * appear — so that is literally what the first test does, generated from the redactor's
 * own key list rather than a hand-copied one that would drift.
 */

/** A value distinctive enough that finding it anywhere in the output is unambiguous. */
const CANARY = "SUPERSECRETCANARY0123456789";

describe("redact — key names", () => {
  it("removes the value of every secret key name, at the top level", () => {
    // Built FROM the redactor's exported list, so a key added there without a matching
    // rule cannot pass this test by being forgotten here too.
    const payload = Object.fromEntries(
      REDACTED_KEY_NAMES.map((k) => [k, CANARY]),
    );

    const output = JSON.stringify(redact(payload));

    expect(output).not.toContain(CANARY);
    expect(REDACTED_KEY_NAMES.length).toBeGreaterThan(20);
    for (const key of REDACTED_KEY_NAMES) {
      expect((redact(payload) as Record<string, unknown>)[key]).toBe(REDACTED);
    }
  });

  it("still guards the key names that must never be dropped", () => {
    // The test above generates its payload FROM the redactor's own list, which means
    // deleting a key from the set removes it from both sides and the test still passes.
    // This is the backstop: an explicit, independent list of the names that matter most,
    // taken from docs/DEVOPS/06 § Mandatory Redaction rather than from the source.
    const mustBeGuarded = [
      "password",
      "token",
      "accessToken",
      "refreshToken",
      "apiKey",
      "authorization",
      "signature",
      "rawCallbackPayload",
      "secret",
    ];

    for (const key of mustBeGuarded) {
      const out = redact({ [key]: CANARY }) as Record<string, unknown>;
      expect(out[key], `${key} must be redacted`).toBe(REDACTED);
    }
  });

  it("matches key names regardless of case, underscores or hyphens", () => {
    // access_token, accessToken, Access-Token and ACCESSTOKEN are one key. A redactor
    // that only knew snake_case would miss every camelCase object in the codebase.
    const variants = {
      access_token: CANARY,
      accessToken: CANARY,
      "Access-Token": CANARY,
      ACCESSTOKEN: CANARY,
      "refresh token": CANARY,
    };
    expect(JSON.stringify(redact(variants))).not.toContain(CANARY);
  });

  it("redacts at any depth, not just the top level", () => {
    // The reason this is a walker and not a list of pino redact paths: a path list
    // needs an entry per shape, and a nested or renamed field slips through silently.
    const nested = {
      request: {
        body: { user: { credentials: { password: CANARY } } },
        headers: { authorization: `Bearer ${CANARY}` },
      },
    };
    expect(JSON.stringify(redact(nested))).not.toContain(CANARY);
  });

  it("redacts inside arrays", () => {
    const payload = { sessions: [{ token: CANARY }, { token: CANARY }] };
    expect(JSON.stringify(redact(payload))).not.toContain(CANARY);
  });

  it("keeps non-sensitive fields intact", () => {
    // A redactor that removes everything is safe and useless. The log still has to be
    // worth reading during an incident.
    const payload = { invitationId: "abc-123", status: "published", count: 42 };
    expect(redact(payload)).toEqual(payload);
  });
});

describe("redact — masking rather than removal", () => {
  it("masks a bank account number to its last four digits", () => {
    // docs/DEVOPS/06. Not a platform credential (ADR-025) -- the couple publishes it --
    // but a log is a different audience from an invitation page, and the suffix is what
    // support actually needs to confirm they are looking at the right account.
    const out = redact({ account_number: "1234567890" }) as Record<
      string,
      string
    >;
    expect(out["account_number"]).toBe("******7890");
    expect(out["account_number"]).not.toContain("123456");
  });

  it("masks a short account number entirely rather than revealing it", () => {
    expect(maskTail("123")).toBe("***");
  });

  it.each(MASKED_KEY_NAMES)("masks %s", (key) => {
    const out = redact({ [key]: "9876543210" }) as Record<string, string>;
    expect(out[key]).toBe("******3210");
  });

  it("partially masks email addresses", () => {
    // Enough to correlate two lines about the same user, not enough to harvest.
    expect(maskEmail("alice@example.com")).toBe("a***e@example.com");
    expect(maskEmail("ab@example.com")).toBe("**@example.com");
  });

  it.each(EMAIL_KEY_NAMES)("masks the email in %s", (key) => {
    const out = redact({ [key]: "someone@example.com" }) as Record<
      string,
      string
    >;
    expect(out[key]).not.toContain("someone");
    expect(out[key]).toContain("@example.com");
  });
});

describe("redact — values that are secret regardless of their key", () => {
  it("scrubs a bearer token hiding in an innocent field", () => {
    // { note: "Authorization: Bearer eyJhb..." } is exactly how a token ends up in a
    // log: pasted into a message while debugging, under a key nobody would guard.
    const out = redact({
      note: `tried Authorization: Bearer ${CANARY} and it failed`,
    });
    expect(JSON.stringify(out)).not.toContain(CANARY);
    expect(JSON.stringify(out)).toContain(REDACTED);
  });

  it("scrubs a JWT anywhere in a string", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc";
    const out = JSON.stringify(redact({ message: `token was ${jwt}` }));
    expect(out).not.toContain("eyJhbGci");
  });
});

describe("redact — robustness", () => {
  it("survives a circular reference", () => {
    // A request object holding a reference to its own socket is normal. An unguarded
    // walk recurses forever, and logging is the last thing that should take a service
    // down.
    const a: Record<string, unknown> = { name: "a" };
    a["self"] = a;
    expect(() => redact(a)).not.toThrow();
    expect(JSON.stringify(redact(a))).toContain("[Circular]");
  });

  it("bounds very deep objects", () => {
    let deep: Record<string, unknown> = { value: "bottom" };
    for (let i = 0; i < 40; i += 1) deep = { nested: deep };
    expect(JSON.stringify(redact(deep))).toContain("depth limit");
  });

  it("bounds very long arrays", () => {
    const long = { items: Array.from({ length: 500 }, (_, i) => i) };
    const out = JSON.stringify(redact(long));
    expect(out).toContain("more]");
    expect(out.length).toBeLessThan(2000);
  });

  it("keeps an Error readable", () => {
    const out = redact(new Error("something broke")) as Record<string, unknown>;
    expect(out["message"]).toBe("something broke");
    expect(out["stack"]).toBeTypeOf("string");
  });

  it("does not serialise a Buffer's contents", () => {
    const out = redact({ file: Buffer.from(CANARY) }) as Record<string, string>;
    expect(out["file"]).toMatch(/^\[Buffer \d+ bytes\]$/);
  });

  it("handles null, undefined and primitives", () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(7)).toBe(7);
    expect(redact(true)).toBe(true);
    expect(redact(10n)).toBe("10");
  });
});

describe("request context", () => {
  it("is available to anything running inside it, across awaits", async () => {
    await runWithRequestContext({ requestId: "req-1" }, async () => {
      await Promise.resolve();
      // Three layers deep and one await later, still attached. This is what stops a
      // log line inside a repository from being the one with no request id on it.
      const inner = async (): Promise<string | undefined> =>
        currentRequestContext()?.requestId;
      expect(await inner()).toBe("req-1");
    });
  });

  it("is undefined outside a request", () => {
    expect(currentRequestContext()).toBeUndefined();
  });

  it("can be enriched once the user is known", () => {
    runWithRequestContext({ requestId: "req-2" }, () => {
      enrichRequestContext({ userId: "user-9" });
      expect(currentRequestContext()?.userId).toBe("user-9");
    });
  });

  it("enriching outside a request is a no-op rather than a crash", () => {
    // A background job has no request context. Throwing here would make the function
    // harder to use than ignoring it, and callers would stop calling it.
    expect(() => enrichRequestContext({ userId: "user-9" })).not.toThrow();
  });
});

describe("the logger itself", () => {
  let lines: string[];
  let testLogger: pino.Logger;

  beforeEach(async () => {
    lines = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    // Built with the same formatters as src/shared/logging/logger.ts. Importing that
    // module directly would write to stdout through a transport worker, which a test
    // cannot capture -- so the formatter behaviour is what is asserted here, and the
    // formatter is where redaction lives.
    testLogger = pino(
      {
        base: { service: "api" },
        timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
        messageKey: "message",
        formatters: {
          level: (label) => ({ level: label }),
          log: (object) => {
            const c = currentRequestContext();
            const out = redact(object) as Record<string, unknown>;
            if (c !== undefined) out["request_id"] = c.requestId;
            return out;
          },
        },
      },
      sink,
    );
  });

  afterEach(() => {
    lines = [];
  });

  it("emits JSON with the documented field names", () => {
    testLogger.info({ context: { path: "/health" } }, "request completed");
    const line = JSON.parse(lines[0]!) as Record<string, unknown>;

    // docs/DEVOPS/06 § Format: timestamp, level, service, request_id, message, context.
    expect(line["timestamp"]).toBeTypeOf("string");
    expect(line["level"]).toBe("info"); // the name, not pino's numeric 30
    expect(line["service"]).toBe("api");
    expect(line["message"]).toBe("request completed");
    expect(line["context"]).toEqual({ path: "/health" });
  });

  it("carries the request_id when one exists", () => {
    runWithRequestContext({ requestId: "req-abc" }, () => {
      testLogger.info("inside a request");
    });
    expect(JSON.parse(lines[0]!)["request_id"]).toBe("req-abc");
  });

  it("omits request_id outside a request rather than inventing one", () => {
    testLogger.info("startup");
    expect(JSON.parse(lines[0]!)["request_id"]).toBeUndefined();
  });

  it("redacts through the real log path, not just through redact()", () => {
    // The end-to-end version of the DoD item: an object with every sensitive key name
    // goes through an actual log call, and none of the values reach the output.
    const payload = Object.fromEntries(
      REDACTED_KEY_NAMES.map((k) => [k, CANARY]),
    );
    testLogger.info({ context: payload }, "handling request");

    expect(lines[0]).not.toContain(CANARY);
    expect(lines[0]).toContain(REDACTED);
  });

  it("redacts an object logged carelessly at the top level", () => {
    // The 2am case: someone logs the whole request to see what is going on.
    testLogger.error(
      { password: CANARY, authorization: `Bearer ${CANARY}` },
      "login failed",
    );
    expect(lines[0]).not.toContain(CANARY);
  });
});

describe("security events", () => {
  it("are tagged so retention can differ from application logs", async () => {
    // docs/DEVOPS/06 § Log Retention: security events for 1 year, application logs for
    // 90 days, "kept separate". The field is what makes that separation possible; the
    // retention itself is P0-23's.
    expect(securityLogger.bindings()["log_type"]).toBe("security");
  });

  it("the application logger is not tagged as security", async () => {
    expect(logger.bindings()["log_type"]).toBeUndefined();
  });
});

describe("job trace propagation (docs/DEVOPS/06 § Request Correlation)", () => {
  it("carries the enqueuing request's id into the job handler", async () => {
    // The DoD item: "a worker job logs the request_id of the request that enqueued it".
    // There is no queue until P0-15, so this proves the mechanism across the boundary
    // the queue will sit on -- serialise on one side, restore on the other.

    const envelope = runWithRequestContext(
      { requestId: "req-upload-1", userId: "user-7" },
      () => enqueueEnvelope({ mediaId: "m-1" }),
    );

    // Round-trips through JSON, because that is what a queue does to a payload.
    const overTheWire = JSON.parse(JSON.stringify(envelope));

    const seen = runJobWithTrace(
      overTheWire as JobEnvelope<{ mediaId: string }>,
      (data) => ({
        data,
        requestId: currentRequestContext()?.requestId,
        userId: currentRequestContext()?.userId,
      }),
    );

    expect(seen.requestId).toBe("req-upload-1");
    expect(seen.userId).toBe("user-7");
    expect(seen.data).toEqual({ mediaId: "m-1" });
  });

  it("generates an id when a scheduler enqueues with no request context", async () => {
    // A cron sweep has no request. Omitting the field would leave those job logs
    // ungroupable, which is worse than a synthetic id.
    const envelope = enqueueEnvelope({ sweep: "expiry" });

    expect(envelope.trace.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(envelope.trace.user_id).toBeUndefined();
  });

  it("survives a malformed envelope rather than failing the job", async () => {
    // A correlation feature must not be able to cause an outage. A job whose trace is
    // unreadable still runs, with a fresh id.

    const result = runJobWithTrace(
      { data: { mediaId: "m-2" } },
      (data: { mediaId: string }) => ({
        data,
        requestId: currentRequestContext()?.requestId,
      }),
    );

    expect(result.data).toEqual({ mediaId: "m-2" });
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("records enqueue time so queue latency is measurable", async () => {
    const before = Date.now();
    const envelope = enqueueEnvelope({});
    expect(
      new Date(envelope.trace.enqueued_at).getTime(),
    ).toBeGreaterThanOrEqual(before - 1);
  });
});
