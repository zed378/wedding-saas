import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The ambient request, available anywhere without being threaded through every call.
 *
 * `docs/DEVOPS/06` § Request Correlation wants a `request_id` on every log line for a
 * request. The alternative to this is passing a logger (or an id) into every service,
 * repository and helper — which works right up until one function forgets, and then the
 * one log line you actually needed during an incident is the one with no id on it.
 *
 * `AsyncLocalStorage` keeps it attached across `await` boundaries, so a log written deep
 * inside a repository still carries the id of the request that caused it.
 */
export interface RequestContext {
  readonly requestId: string;
  /** Set once authentication runs (`P1-06`). Absent for public and unauthenticated calls. */
  readonly userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with this context attached to everything it awaits. */
export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

/** The current context, or undefined outside a request — a job, a boot-time log. */
export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Add to the current context without replacing it.
 *
 * Used by the auth middleware to attach `userId` once it is known. Returns silently when
 * there is no context: a background job has none, and refusing to run there would make
 * this harder to use than ignoring it.
 */
export function enrichRequestContext(
  fields: Partial<Omit<RequestContext, "requestId">>,
): void {
  const current = storage.getStore();
  if (current === undefined) return;
  Object.assign(current, fields);
}
