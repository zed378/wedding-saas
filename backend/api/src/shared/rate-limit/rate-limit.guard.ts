import { createHash } from "node:crypto";
import {
  Inject,
  Injectable,
  mixin,
  type CanActivate,
  type ExecutionContext,
  type Type,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { RateLimitedError, ServiceUnavailableError } from "../../http/errors";
import { maybeCurrentUser } from "../auth-middleware/current-user";
import { isExemptPath, type RateLimitPolicy } from "./policies";
import { PolicyRegistry } from "./config";
import {
  RateLimiter,
  RateLimiterUnavailableError,
  type RateLimitDecision,
} from "./rate-limiter";

export const RATE_LIMITER = Symbol("RATE_LIMITER");
export const POLICY_REGISTRY = Symbol("POLICY_REGISTRY");

/**
 * P1-07 — applying a policy to a route, and the headers `docs/API/00` requires.
 *
 * ## The headers go on every response, not just refusals
 *
 * `docs/API/00` § Rate Limiting names three headers and does not say "when refused". A
 * client can only back off before hitting a wall if it can see the wall coming, and a
 * `Remaining` that appears only in the 429 arrives exactly one request too late.
 */

/** How each `RateLimitKeyKind` turns a request into a bucket. */
export function deriveKey(
  policy: RateLimitPolicy,
  req: Request,
): string | undefined {
  const ip = clientIp(req);

  switch (policy.key) {
    case "ip":
      return ip;

    case "user": {
      // Undefined when the route has no `requireAuth()`. The guard then skips rather
      // than falling back to the IP: a per-user limit silently applied per-IP would
      // throttle a household or an office to one user's budget.
      const user = maybeCurrentUser(req);
      return user?.id;
    }

    case "email+ip": {
      const body: unknown = req.body;
      const email =
        typeof body === "object" && body !== null
          ? (body as { email?: unknown }).email
          : undefined;

      // No email in the body means this policy has nothing to key on. Fall back to the
      // IP alone rather than skipping -- an attacker who omits the field must not thereby
      // escape the limit.
      return typeof email === "string" && email.length > 0
        ? `${email.trim().toLowerCase()}|${ip}`
        : `|${ip}`;
    }

    case "iphash+slug": {
      // `docs/SECURITY/09`: a guest's IP is not stored in the clear. The slug is public.
      const slug = req.params["slug"];
      return slug === undefined ? undefined : `${hashIp(ip)}|${slug}`;
    }
  }
}

/**
 * The client address.
 *
 * `X-Forwarded-For` is honoured because the API sits behind Caddy and Cloudflare
 * (`docs/ARCHITECTURE/04`), so `req.ip` would otherwise be the proxy for every request in
 * production -- one bucket for the entire internet. Express only populates
 * `req.ips`/`req.ip` from the header when `trust proxy` is set, which is why this reads
 * `req.ip` rather than the raw header: taking the header directly would let any client
 * pick their own bucket by sending one.
 */
function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

function applyHeaders(res: Response, decision: RateLimitDecision): void {
  res.setHeader("X-RateLimit-Limit", String(decision.limit));
  res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
  res.setHeader("X-RateLimit-Reset", String(decision.resetAt));
}

/**
 * Guard a route with a named policy.
 *
 * ```ts
 * @Post("login")
 * @UseGuards(rateLimit("login"))
 * ```
 *
 * For an `onFailureOnly` policy this checks but does not consume; the service calls
 * `recordFailure` when the attempt fails, because the guard runs first and cannot know.
 */
export function rateLimit(policyName: string): Type<CanActivate> {
  @Injectable()
  class RateLimitGuard implements CanActivate {
    constructor(
      @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
      @Inject(POLICY_REGISTRY) private readonly registry: PolicyRegistry,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const http = context.switchToHttp();
      const req = http.getRequest<Request>();
      const res = http.getResponse<Response>();

      // `docs/SECURITY/02` boundary 5. A provider retrying a webhook is legitimate
      // traffic, and throttling it into failure loses a payment notification -- which
      // `docs/SECURITY/07` makes the only source of truth for payment status.
      if (isExemptPath(req.path)) return true;

      const policy = this.registry.get(policyName);
      const key = deriveKey(policy, req);

      // No key means the policy does not apply to this request (an unauthenticated hit
      // on a per-user policy, a public route with no slug). Skipping is correct; keying
      // it on something else would put unrelated callers in one bucket.
      if (key === undefined) return true;

      let decision: RateLimitDecision;
      try {
        decision = await this.limiter.check(policy, key);
      } catch (error) {
        if (error instanceof RateLimiterUnavailableError) {
          // 503, not 429. A 429 tells the client to slow down, which is false, and a
          // client with backoff would wait for a limit that is not the problem.
          throw new ServiceUnavailableError(
            "Layanan sedang tidak tersedia. Coba lagi sebentar lagi.",
          );
        }
        throw error;
      }

      applyHeaders(res, decision);

      if (!decision.allowed) {
        if (decision.retryAfterSeconds !== undefined) {
          res.setHeader("Retry-After", String(decision.retryAfterSeconds));
        }
        // Not already blocked: earn a strike. `docs/SECURITY/10` § Monitoring.
        if (decision.blocked !== true) {
          await this.limiter.block(policy, key);
        }
        throw new RateLimitedError();
      }

      return true;
    }
  }

  return mixin(RateLimitGuard);
}
