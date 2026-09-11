import pino, {
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from "pino";

import { redact } from "./redact.js";
import { currentRequestContext } from "./request-context.js";

/**
 * The logger both the API and the worker use.
 *
 * Extracted from `@wi/api` in `P0-19.1`. The `P0-15` record predicted the cost of not
 * doing this and `P0-19` paid it: a crash-on-startup fix had to be applied twice, once
 * per copy. More importantly the worker's copy **did not redact at all** — `P0-15`
 * recorded that as "a discipline rather than a mechanism, which is exactly what
 * `docs/DEVOPS/06` says redaction must not be". That gap closes here.
 *
 * Two properties, unchanged from `P0-12`:
 *
 *   1. **Redaction happens in the formatter**, so a developer cannot leak a password by
 *      logging the wrong object — which is how it happens.
 *   2. **`request_id` is ambient**, via AsyncLocalStorage, so a line written three
 *      layers deep still carries the id of the request that caused it.
 */

export type SecurityEventType =
  | "auth.login_failed"
  /**
   * The breached-password check could not run, so the password was accepted without it
   * (ADR-044, `P1-01`). A control that fails open has to be one that somebody can see
   * failing, or it is just a control that is off.
   */
  | "auth.breach_check_unavailable"
  | "auth.token_reuse_detected"
  | "authz.idor_attempt"
  | "payment.invalid_signature"
  | "admin.tenant_bypass"
  | "upload.rejected";

export interface LoggerConfig {
  /** Appears as `service` on every line. `api`, `worker-media`, and so on. */
  readonly service: string;
  readonly level?: string;
}

/**
 * Pretty output only when `pino-pretty` is actually installed.
 *
 * **Not keyed on `NODE_ENV`**, and that distinction is a crash rather than a nicety.
 * `pino-pretty` is a devDependency, so `pnpm deploy --prod` strips it from a runtime
 * image — while `deploy/docker-compose.yml` runs that image with `NODE_ENV=development`,
 * because it is a local stack. Keying on `NODE_ENV` made the API try to load a transport
 * that was not there, and pino throws during module initialisation: the process exited
 * before serving a single request.
 *
 * Found by `P0-19`'s E2E suite, which was the first thing to exercise the built image
 * rather than the source.
 */
function prettyTransport(): Pick<LoggerOptions, "transport"> {
  if (process.env["LOG_PRETTY"] === "false") return {};

  try {
    // Resolve rather than import: this only asks whether the module *could* be loaded,
    // which is exactly the question, and costs nothing when the answer is yes.
    //
    // Plain `require` because this package emits CommonJS (`module: NodeNext`, no
    // `"type": "module"`), where the ESM equivalent is a compile error. If this is ever
    // consumed from an ESM build `require` is undefined, the ReferenceError lands in
    // this same `catch`, and the result is structured JSON -- safe either way.
    require.resolve("pino-pretty");
  } catch {
    // Absent. Structured JSON is the right fallback and is what production wants
    // anyway — degrading beats refusing to start.
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

/**
 * Build a logger. `docs/DEVOPS/06` § Format: `timestamp`, `level`, `service`,
 * `request_id`, `message`, `context`.
 */
export function createLogger(
  config: LoggerConfig,
  /**
   * Where the lines go. Omitted in production, where pino's default (stdout) is right.
   *
   * It exists so a test can assert what **this function** produces rather than what a
   * hand-built pino instance with the same options produces. Those are different claims,
   * and only the first one catches a formatter that was dropped from this file --
   * see `logger.spec.ts`.
   */
  destination?: DestinationStream,
): Logger {
  const options: LoggerOptions = {
    level:
      config.level ??
      process.env["LOG_LEVEL"] ??
      (process.env["NODE_ENV"] === "production" ? "info" : "debug"),
    base: { service: config.service },
    // docs/DEVOPS/06 asks for `timestamp`; pino's default key is `time`.
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    messageKey: "message",
    formatters: {
      // `level: 30` is not a documented field value. Emit the name.
      level: (label) => ({ level: label }),
      log: (object) => {
        const context = currentRequestContext();
        const out = redact(object) as Record<string, unknown>;
        if (context !== undefined) {
          out["request_id"] = context.requestId;
          if (context.userId !== undefined) out["user_id"] = context.userId;
        }
        return out;
      },
    },
    // A caller-supplied destination and a transport are mutually exclusive in pino,
    // and the destination is the explicit request -- so it wins.
    ...(destination === undefined ? prettyTransport() : {}),
  };

  return destination === undefined ? pino(options) : pino(options, destination);
}

/**
 * A separately-tagged stream for security events.
 *
 * `docs/DEVOPS/06` § Log Retention keeps these for **1 year** against 90 days for
 * application logs, "kept separate from general application logs". Separation is by a
 * field rather than a second file: the aggregator routes on `log_type`, and a second
 * file would need its own rotation, shipping and disk budget — a security log that fills
 * a disk stops being written.
 */
export function createSecurityLogger(base: Logger): Logger {
  return base.child({ log_type: "security" });
}

/**
 * Record a security event. Always `warn` or above, so a production level of `info`
 * cannot filter it out.
 *
 * The event names are a closed set because these are the lines someone greps during an
 * incident, and free-text names make that grep unreliable.
 */
export function logSecurityEvent(
  securityLogger: Logger,
  event: SecurityEventType,
  context: Record<string, unknown> = {},
  level: "warn" | "error" = "warn",
): void {
  securityLogger[level]({ event, context }, `security event: ${event}`);
}
