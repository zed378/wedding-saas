import pino, { type Logger, type LoggerOptions } from "pino";
import { createRequire } from "node:module";

/**
 * The worker's logger.
 *
 * Deliberately a small copy of the API's shape rather than an import from it: the two
 * are separate processes and separate packages, and a shared logging package is P0-19's
 * to extract once there are two real consumers. Duplicating twenty lines is cheaper than
 * a premature package, and the field names are what actually have to match.
 *
 * NOTE: this does NOT redact. The API's redactor lives in @wi/api (P0-12) and the worker
 * cannot import it across the package boundary yet. Until it can, the worker logs only
 * fields it constructs itself -- job names, ids, durations, error messages -- and never
 * a whole payload. That is a real limitation and it is written down rather than assumed.
 */
const SERVICE = process.env["SERVICE_NAME"] ?? "worker";

/**
 * Pretty output only when pino-pretty is actually installed.
 *
 * NOT keyed on NODE_ENV -- see the same function in the API for the crash that caused.
 * pino-pretty is a devDependency and is stripped from the runtime image, while the
 * compose stack runs that image with NODE_ENV=development. The API exited during module
 * initialisation, before serving a single request.
 */
function prettyTransport(): Pick<LoggerOptions, "transport"> {
  if (process.env["LOG_PRETTY"] === "false") return {};

  try {
    createRequire(import.meta.url).resolve("pino-pretty");
  } catch {
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

export const logger: Logger = pino({
  level:
    process.env["LOG_LEVEL"] ??
    (process.env["NODE_ENV"] === "production" ? "info" : "debug"),
  base: { service: SERVICE },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  messageKey: "message",
  formatters: { level: (label) => ({ level: label }) },
  ...prettyTransport(),
});
