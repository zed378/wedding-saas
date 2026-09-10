import pino, { type Logger, type LoggerOptions } from "pino";

import { redact } from "./redact";
import { currentRequestContext } from "./request-context";

/**
 * The application logger.
 *
 * `docs/DEVOPS/06` § Format: structured JSON with `timestamp`, `level`, `service`,
 * `request_id`, `message` and `context`. Pino's defaults are close but not identical, so
 * the formatters below rename its fields to the documented ones rather than leaving two
 * conventions in one system.
 *
 * Two properties matter more than the field names:
 *
 *   1. **Redaction happens here, not at the call site.** Every object passed to a log
 *      method goes through `redact()` before serialisation. A developer cannot leak a
 *      password by logging the wrong object, which is exactly how it happens.
 *   2. **`request_id` is ambient.** It comes from AsyncLocalStorage, so a log written
 *      three layers deep still carries the id of the request that caused it.
 */

export type SecurityEventType =
  | "auth.login_failed"
  | "auth.token_reuse_detected"
  | "authz.idor_attempt"
  | "payment.invalid_signature"
  | "admin.tenant_bypass"
  | "upload.rejected";

/**
 * These three read `process.env` DIRECTLY, which `src/config/config.module.ts` otherwise
 * forbids -- "a value read straight from the environment is a value nobody validated".
 *
 * The exception is deliberate and narrow. The logger has to exist before the Nest
 * container is constructed, because the most important thing it will ever log is a
 * failure during construction: a bad `DATABASE_URL`, a missing signing key. A logger
 * that depends on the config module cannot report the config module refusing to start.
 *
 * The blast radius is small by design: a bad value here changes a label, a level or the
 * output format. None of them can leak anything, because redaction is not configurable.
 */
const SERVICE = process.env["SERVICE_NAME"] ?? "api";

function baseOptions(): LoggerOptions {
  return {
    level:
      process.env["LOG_LEVEL"] ??
      (process.env["NODE_ENV"] === "production" ? "info" : "debug"),
    base: { service: SERVICE },
    // docs/DEVOPS/06 asks for `timestamp`; pino's default key is `time`.
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    messageKey: "message",
    formatters: {
      // `level: 30` is not a documented field value. Emit the name.
      level: (label) => ({ level: label }),
      /**
       * Runs for every log line. Two jobs: attach the ambient request id, and redact.
       *
       * Doing redaction here rather than in a `redact` path list is the point — see
       * redact.ts. It costs a walk of the object per line, which is the correct trade
       * against a leaked credential in a log with 90-day retention.
       */
      log: (object) => {
        const context = currentRequestContext();
        const redacted = redact(object) as Record<string, unknown>;
        if (context !== undefined) {
          redacted["request_id"] = context.requestId;
          if (context.userId !== undefined)
            redacted["user_id"] = context.userId;
        }
        return redacted;
      },
    },
  };
}

/**
 * Development gets human-readable output; production gets one JSON object per line for
 * the aggregator (`docs/DEVOPS/06` § Aggregation). Redaction is identical in both --
 * pretty-printing happens after the formatter, so a development log is no leakier.
 */
/**
 * Development gets human-readable output; production gets one JSON object per line for
 * the aggregator (`docs/DEVOPS/06` § Aggregation). Redaction is identical in both --
 * pretty-printing happens after the formatter, so a development log is no leakier.
 *
 * The decision is "is pino-pretty actually installed", NOT "what is NODE_ENV".
 *
 * That distinction is not pedantry, it is a crash. `pino-pretty` is a devDependency, so
 * `pnpm deploy --prod` strips it from the runtime image -- while `deploy/docker-compose.yml`
 * runs that image with `NODE_ENV=development`, because it is a local stack. Keying on
 * NODE_ENV therefore made the container try to load a transport that was not there, and
 * pino throws during module initialisation: the API exited before it served a single
 * request.
 *
 * It was found by the P0-19 E2E suite asking the running container for a route that had
 * existed since P0-13 and getting a 404 -- the first time anything had exercised the
 * built image rather than the source.
 */
function prettyTransport(): Pick<LoggerOptions, "transport"> {
  if (process.env["LOG_PRETTY"] === "false") return {};

  try {
    // Resolve rather than import: this only asks whether the module could be loaded,
    // which is exactly the question, and costs nothing when the answer is yes.
    require.resolve("pino-pretty");
  } catch {
    // Absent. Structured JSON is the correct fallback and is what production wants
    // anyway -- degrading to it is strictly better than refusing to start.
    return {};
  }

  return {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname,service",
      },
    },
  };
}

export const logger: Logger = pino({ ...baseOptions(), ...prettyTransport() });

/**
 * The security event stream.
 *
 * `docs/DEVOPS/06` § Log Retention keeps security events for **1 year** against 90 days
 * for application logs, and requires them "kept separate from general application logs".
 *
 * Separation is by a field rather than a second file, deliberately: at this scale both
 * streams go to stdout and the aggregator routes on `log_type = "security"`. A second
 * file would need its own rotation, shipping and disk budget to solve a problem the
 * aggregator already solves — and a security log that fills a disk stops being written.
 *
 * The field is what makes differential retention possible, which is what the document
 * actually asks for. `P0-23` configures the retention itself.
 */
export const securityLogger: Logger = logger.child({ log_type: "security" });

/**
 * Record a security event. Always at `warn` or above, so it is never filtered out by a
 * production level of `info`.
 *
 * The `event` values are a closed set because these are the lines someone greps during
 * an incident, and free-text event names make that grep unreliable.
 */
export function logSecurityEvent(
  event: SecurityEventType,
  context: Record<string, unknown> = {},
  level: "warn" | "error" = "warn",
): void {
  securityLogger[level]({ event, context }, `security event: ${event}`);
}
