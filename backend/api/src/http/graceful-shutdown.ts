import type { Server } from "node:http";

export interface ShutdownOptions {
  /** How long in-flight requests are given to finish before the process exits anyway. */
  readonly timeoutMs: number;
  readonly onTimeout?: () => void;
}

/**
 * Stop accepting connections, let in-flight requests finish, then resolve.
 *
 * Two details carry the weight:
 *
 * `server.close()` stops new connections and waits for open ones, but a keep-alive
 * connection sitting idle counts as open -- so a browser tab holding a connection would
 * block shutdown until its own timeout. `closeIdleConnections()` releases exactly those
 * while leaving connections with a request in flight alone.
 *
 * The timeout is a bound, not a target. A deploy that hangs because one request will not
 * finish is worse than one that drops it, so the wait is capped and the fact is reported
 * rather than swallowed -- P0-12 turns `onTimeout` into a warning log, and a rising rate
 * of it means something is holding requests open longer than a rollout can wait.
 */
export function gracefulShutdown(
  server: Server,
  options: ShutdownOptions,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      options.onTimeout?.();
      finish();
    }, options.timeoutMs);
    timer.unref();

    server.close(() => finish());

    // Release idle keep-alive sockets; sockets mid-request are untouched.
    server.closeIdleConnections();
  });
}
