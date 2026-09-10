import type { Logger } from "pino";
import {
  createLogger,
  createSecurityLogger,
  logSecurityEvent as logSecurityEventTo,
  type SecurityEventType,
} from "@wi/logging";

/**
 * The API's two logger instances.
 *
 * Everything that used to live in this directory now lives in `@wi/logging` (`P0-19.1`).
 * What stays here is the only part that is genuinely the API's: which service name goes
 * on every line, and the two singletons the Nest module injects.
 *
 * `SERVICE_NAME` is read once, at module load. It is a label, not a control — a wrong
 * value mislabels lines and cannot leak anything, because redaction is not configurable.
 */
const SERVICE = process.env["SERVICE_NAME"] ?? "api";

export const logger: Logger = createLogger({ service: SERVICE });

/**
 * The security event stream. `docs/DEVOPS/06` § Log Retention keeps these for 1 year
 * against 90 days for application logs; the `log_type` field is what lets the aggregator
 * apply two retentions to one stdout stream. `P0-23` configures the retention itself.
 */
export const securityLogger: Logger = createSecurityLogger(logger);

export type { SecurityEventType };

/**
 * Record a security event.
 *
 * Pre-bound to `securityLogger` rather than re-exported. The package's version takes the
 * logger as its first argument, which is right for a package and wrong for a call site:
 * passing `logger` instead of `securityLogger` would compile, run, and quietly drop the
 * event out of the 1-year retention stream into the 90-day one. Binding it here means
 * that mistake cannot be made in this process.
 */
export function logSecurityEvent(
  event: SecurityEventType,
  context: Record<string, unknown> = {},
  level: "warn" | "error" = "warn",
): void {
  logSecurityEventTo(securityLogger, event, context, level);
}
