import { describe, it, expect, beforeEach } from "vitest";
import { Writable } from "node:stream";

import {
  createLogger,
  createSecurityLogger,
  logSecurityEvent,
} from "./logger.js";
import { runWithRequestContext } from "./request-context.js";
import { REDACTED, REDACTED_KEY_NAMES } from "./redact.js";

/**
 * `P0-19.1` — what `createLogger` itself produces.
 *
 * `logging.spec.ts` builds a pino instance with the same formatters and asserts those
 * redact. That is a test of the formatters, not of this function: delete the `log`
 * formatter from `logger.ts` and every assertion in that file still passes, because it
 * never calls `createLogger`. This file closes that gap by logging through the real
 * factory and reading what comes out the other end.
 *
 * Verified by mutation: replacing `redact(object)` with `object` in `logger.ts` fails
 * exactly two tests here -- "redacts every secret key name, through the real factory"
 * and "redacts a whole object logged carelessly at the top level" -- while all 39 tests
 * in `logging.spec.ts` still pass. That is the gap, measured.
 */

const CANARY = "SUPERSECRETCANARY0123456789";

/** Every key the redactor blanks, plus one it does not — the negative half. */
const PAYLOAD = {
  ...Object.fromEntries(REDACTED_KEY_NAMES.map((k) => [k, CANARY])),
  slug: "budi-dan-siti",
};

describe("createLogger", () => {
  let lines: string[];
  let sink: Writable;

  beforeEach(() => {
    lines = [];
    sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
  });

  const parse = (): Record<string, unknown> =>
    JSON.parse(lines[0]!) as Record<string, unknown>;

  it("emits the field names docs/DEVOPS/06 § Format names", () => {
    createLogger({ service: "worker-media" }, sink).info(
      { context: { job: "media.process" } },
      "job completed",
    );

    const line = parse();
    expect(line["timestamp"]).toBeTypeOf("string");
    expect(line["level"]).toBe("info"); // the name, not pino's numeric 30
    expect(line["service"]).toBe("worker-media");
    expect(line["message"]).toBe("job completed");
    expect(line["context"]).toEqual({ job: "media.process" });
  });

  it("redacts every secret key name, through the real factory", () => {
    // The whole reason the package exists: the worker's own logger (P0-15) did not
    // redact at all, and `docs/DEVOPS/06` § Mandatory Redaction forbids leaving this to
    // "manual developer discipline each time".
    createLogger({ service: "worker" }, sink).info(
      { context: PAYLOAD },
      "processing",
    );

    expect(lines[0]).not.toContain(CANARY);
    expect(lines[0]).toContain(REDACTED);
  });

  it("redacts a whole object logged carelessly at the top level", () => {
    // The 2am case: someone logs the entire request to see what is going on.
    createLogger({ service: "api" }, sink).error(
      { password: CANARY, authorization: `Bearer ${CANARY}` },
      "login failed",
    );
    expect(lines[0]).not.toContain(CANARY);
  });

  it("leaves non-secret fields alone", () => {
    // Without this, a redactor that blanked everything would pass the tests above.
    createLogger({ service: "api" }, sink).info(
      { context: PAYLOAD },
      "processing",
    );
    expect(parse()["context"]).toMatchObject({ slug: "budi-dan-siti" });
  });

  it("carries the ambient request_id without being passed one", () => {
    const log = createLogger({ service: "api" }, sink);
    runWithRequestContext({ requestId: "req-abc", userId: "user-7" }, () => {
      log.info("three layers deep");
    });

    expect(parse()["request_id"]).toBe("req-abc");
    expect(parse()["user_id"]).toBe("user-7");
  });

  it("omits request_id outside a request rather than inventing one", () => {
    createLogger({ service: "api" }, sink).info("startup");
    expect(parse()["request_id"]).toBeUndefined();
  });

  it("honours an explicit level over the environment default", () => {
    const log = createLogger({ service: "api", level: "warn" }, sink);
    log.info("filtered");
    log.warn("kept");

    expect(lines).toHaveLength(1);
    expect(parse()["message"]).toBe("kept");
  });
});

describe("createSecurityLogger", () => {
  it("tags its lines so retention can differ from application logs", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });

    const base = createLogger({ service: "api" }, sink);
    logSecurityEvent(createSecurityLogger(base), "authz.idor_attempt", {
      invitation_id: "inv-1",
    });

    const line = JSON.parse(lines[0]!) as Record<string, unknown>;
    // docs/DEVOPS/06 § Log Retention: 1 year for these, 90 days for application logs.
    expect(line["log_type"]).toBe("security");
    expect(line["event"]).toBe("authz.idor_attempt");
    // warn or above, so a production level of `info` cannot filter an attack out.
    expect(line["level"]).toBe("warn");
    expect(base.bindings()["log_type"]).toBeUndefined();
  });
});
