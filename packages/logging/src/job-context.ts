import { randomUUID } from "node:crypto";

import {
  currentRequestContext,
  runWithRequestContext,
} from "./request-context.js";

/**
 * Carrying `request_id` across the queue boundary.
 *
 * `docs/DEVOPS/06` § Request Correlation asks for the id to be "passed along across
 * services & into async jobs (included in the job payload)", and `docs/DEVOPS/05`
 * § Distributed Tracing wants an upload traceable from the HTTP request through worker
 * completion.
 *
 * The queue is the point where correlation is normally lost: the HTTP request finishes,
 * the job runs minutes later in another process, and the two sets of log lines have
 * nothing in common. Someone investigating "this photo never appeared" then has to
 * correlate by timestamp and guesswork.
 *
 * **There is no queue yet** — BullMQ arrives with `P0-15`. This is the envelope and the
 * two functions that use it, tested, so that `P0-15` wires up something already proven
 * rather than inventing the convention under time pressure.
 */

/** What every job payload carries alongside its own data. */
export interface JobTrace {
  /** The request that enqueued this job, or a fresh id when a scheduler did. */
  readonly request_id: string;
  /** The user the request belonged to, when there was one. */
  readonly user_id?: string;
  /** When the job was enqueued, so queue latency is measurable without a second clock. */
  readonly enqueued_at: string;
}

export interface JobEnvelope<T> {
  readonly trace: JobTrace;
  readonly data: T;
}

/**
 * Wrap job data with the current request's trace.
 *
 * Called on the producer side, inside the request. If there is no request context — a
 * cron sweep, a startup task — a fresh id is generated rather than omitting the field,
 * because a job with no correlation id is a job whose logs cannot be grouped at all.
 */
export function enqueueEnvelope<T>(data: T): JobEnvelope<T> {
  const context = currentRequestContext();
  return {
    trace: {
      request_id: context?.requestId ?? randomUUID(),
      ...(context?.userId !== undefined ? { user_id: context.userId } : {}),
      enqueued_at: new Date().toISOString(),
    },
    data,
  };
}

/**
 * Run a job handler with the enqueuing request's context restored.
 *
 * Called on the consumer side. Every log line the handler writes then carries the same
 * `request_id` as the HTTP request that caused it, which is the entire point: one grep
 * spans both processes.
 *
 * Tolerates a malformed or missing envelope rather than throwing. A job that fails
 * because its trace was unreadable would be a correlation feature causing an outage,
 * which is the wrong way round — it falls back to a fresh id and carries on.
 */
export function runJobWithTrace<T, R>(
  envelope: JobEnvelope<T> | { data?: T },
  handler: (data: T) => R,
): R {
  const trace = (envelope as JobEnvelope<T>).trace;
  const requestId =
    typeof trace?.request_id === "string" && trace.request_id.length > 0
      ? trace.request_id
      : randomUUID();

  const context =
    typeof trace?.user_id === "string"
      ? { requestId, userId: trace.user_id }
      : { requestId };

  return runWithRequestContext(context, () => handler(envelope.data as T));
}
