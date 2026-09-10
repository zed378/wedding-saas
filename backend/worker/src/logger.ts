import type { Logger } from "pino";
import { createLogger } from "@wi/logging";

/**
 * The worker's logger.
 *
 * `P0-15` shipped this as a deliberate copy of the API's shape with a note attached:
 * "**this does NOT redact** ... the worker logs only fields it constructs itself, and
 * never a whole payload. That is a real limitation and it is written down rather than
 * assumed." `docs/DEVOPS/06` § Mandatory Redaction is explicit that redaction must not
 * "rely on manual developer discipline each time" -- which is exactly what that note
 * described.
 *
 * `P0-19.1` extracted `@wi/logging`, so the worker now redacts through the same
 * formatter as the API. The limitation is closed, not deferred again.
 */
const SERVICE = process.env["SERVICE_NAME"] ?? "worker";

export const logger: Logger = createLogger({ service: SERVICE });
