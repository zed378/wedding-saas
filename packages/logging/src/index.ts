/**
 * `@wi/logging` — structured logging with redaction, shared by the API and the worker.
 *
 * Extracted in `P0-19.1`. Before that the two surfaces had separate copies, and the
 * worker's copy did not redact at all — which `docs/DEVOPS/06` § Mandatory Redaction
 * forbids by name: it must not "rely on manual developer discipline each time".
 */
export {
  createLogger,
  createSecurityLogger,
  logSecurityEvent,
  type LoggerConfig,
  type SecurityEventType,
} from "./logger.js";

export {
  redact,
  maskTail,
  maskEmail,
  REDACTED,
  REDACTED_KEY_NAMES,
  MASKED_KEY_NAMES,
  EMAIL_KEY_NAMES,
} from "./redact.js";

export {
  runWithRequestContext,
  currentRequestContext,
  enrichRequestContext,
  type RequestContext,
} from "./request-context.js";

export {
  enqueueEnvelope,
  runJobWithTrace,
  type JobEnvelope,
  type JobTrace,
} from "./job-context.js";
