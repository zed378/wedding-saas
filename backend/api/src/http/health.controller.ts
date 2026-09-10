import { Controller, Get } from "@nestjs/common";

/**
 * Liveness. Answers only "this process is up and serving" -- it touches no dependency,
 * because a liveness probe that checks the database restarts a healthy service during a
 * database blip and turns one outage into two.
 *
 * `P0-13` adds readiness (`/readyz`), which does check PostgreSQL and Redis, and is what
 * the load balancer uses to decide whether to send traffic. The distinction matters:
 * liveness answers "should I be restarted", readiness answers "should I get requests".
 *
 * Neither discloses infrastructure detail -- an unauthenticated probe endpoint that names
 * versions or hosts is free reconnaissance (docs/DEVOPS/05 § Health Check).
 */
@Controller("health")
export class HealthController {
  @Get()
  live(): { status: "ok" } {
    return { status: "ok" };
  }
}
