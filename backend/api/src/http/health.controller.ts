import { Controller, Get, Inject, Res, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import type { Pool } from "pg";

import { DB_POOL } from "../infra/db/client";
import { logger } from "../shared/logging/logger";

/**
 * Liveness and readiness. `docs/DEVOPS/05` § Health Check.
 *
 * The two answer different questions and confusing them causes outages in opposite
 * directions:
 *
 *   **liveness**  — "should I be restarted?" Touches no dependency. A liveness probe
 *                   that checks the database restarts every healthy replica during a
 *                   database blip, turning one outage into two.
 *   **readiness** — "should I get traffic?" Does check dependencies, because a pod that
 *                   cannot reach PostgreSQL should be taken out of the load balancer
 *                   rather than serve errors.
 *
 * Neither discloses infrastructure detail. An unauthenticated probe that names versions,
 * hosts or driver errors is free reconnaissance, so the body is a fixed shape and the
 * reason a check failed goes to the log instead.
 *
 * Both responses are raw JSON rather than the `docs/API/00` envelope. Probes are not API
 * clients -- a load balancer matches on the status code, and wrapping the answer in
 * `{success, data}` would add a layer for nothing. The envelope governs `/api/v1` and
 * `/public`; this is neither.
 */
@Controller()
export class HealthController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @Get("health")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  /**
   * Readiness. 200 when every critical dependency answers, 503 otherwise.
   *
   * `SELECT 1` and nothing more -- `docs/DEVOPS/05` asks for connectivity "without
   * performing heavy operations". A readiness check that runs a real query becomes a
   * load source of its own at one request per second per replica, and the first thing
   * to fall over under pressure is then the thing measuring the pressure.
   *
   * The timeout matters as much as the query. Without one, a hung connection leaves the
   * probe hanging too, the orchestrator's own timeout fires, and the failure is reported
   * as "probe timed out" with nothing in the log saying which dependency was to blame.
   */
  @Get("readyz")
  async ready(@Res() res: Response): Promise<void> {
    const checks = await Promise.all([
      this.check("database", () => this.pool.query("SELECT 1")),
    ]);

    const failed = checks.filter((c) => !c.ok);

    if (failed.length > 0) {
      // Logged with the reason; the response carries none of it.
      logger.warn(
        {
          context: {
            failed: failed.map((f) => ({ name: f.name, error: f.error })),
          },
        },
        "readiness check failed",
      );

      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: "unavailable",
        // Names WHICH dependency, not why. An operator reading a dashboard needs the
        // first; an attacker probing an unauthenticated endpoint would take the second.
        checks: Object.fromEntries(
          checks.map((c) => [c.name, c.ok ? "ok" : "unavailable"]),
        ),
      });
      return;
    }

    res.status(HttpStatus.OK).json({
      status: "ok",
      checks: Object.fromEntries(checks.map((c) => [c.name, "ok"])),
    });
  }

  private async check(
    name: string,
    probe: () => Promise<unknown>,
  ): Promise<{ name: string; ok: boolean; error?: string }> {
    try {
      await withTimeout(probe(), 2_000);
      return { name, ok: true };
    } catch (error) {
      return { name, ok: false, error: describe(error) };
    }
  }
}

/**
 * A description worth putting in a log.
 *
 * `error.message` alone is not enough, and this was found by running it: when PostgreSQL
 * is unreachable, `pg` throws an **AggregateError with an empty message** and puts the
 * useful part in `.code` (`ECONNREFUSED`) and `.errors[]`. The readiness check worked
 * perfectly and logged `error: ""`, which is the kind of thing that costs an hour at
 * 3am while someone re-reads correct code looking for the bug.
 *
 * This never reaches a client -- only the log. The response body still says nothing but
 * which dependency is down.
 */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const parts: string[] = [];
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") parts.push(code);
  if (error.message.length > 0) parts.push(error.message);

  // AggregateError -- what pg throws when every address for a host refuses.
  const nested = (error as { errors?: unknown }).errors;
  if (Array.isArray(nested)) {
    const inner = nested
      .map((e) =>
        e instanceof Error
          ? `${(e as { code?: string }).code ?? ""} ${e.message}`.trim()
          : String(e),
      )
      .filter((m) => m.length > 0);
    if (inner.length > 0) parts.push(inner.join("; "));
  }

  return parts.length > 0 ? parts.join(": ") : error.name;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`timed out after ${ms}ms`)),
        ms,
      ).unref(),
    ),
  ]);
}
