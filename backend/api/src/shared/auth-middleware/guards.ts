import {
  Injectable,
  mixin,
  type CanActivate,
  type ExecutionContext,
  type Type,
} from "@nestjs/common";
import type { Request } from "express";

import { ForbiddenError } from "../../http/errors";
import { SessionService } from "../../modules/auth/session.service";
import { attachCurrentUser, currentUser } from "./current-user";

/**
 * P1-06 — `requireAuth()` and `requireRole(...)`, the two request-level guards
 * `docs/SECURITY/04` § Mandatory Middleware mandates.
 *
 * The third name, `requireOwnership`, is deliberately NOT here. See
 * `require-ownership.ts`: the same document's Implementation Principle 2 says ownership
 * is checked in the service "so no code path can accidentally bypass it when the service
 * is called from elsewhere (e.g., from a job/worker)" — and a guard is precisely a thing
 * that only runs for an HTTP request. Putting it beside these two would be the mistake
 * the principle warns about, dressed as consistency.
 */

/**
 * Valid token, live user, injected into the request.
 *
 * Everything expensive about this is `SessionService.authenticate` (`P1-03`): it verifies
 * the signature and then **re-reads the user row**, so `role`, `status` and
 * `email_verified` are the database's answer and not the token's. A suspended user's next
 * request fails here rather than fifteen minutes later.
 */
export function requireAuth(): Type<CanActivate> {
  @Injectable()
  class RequireAuthGuard implements CanActivate {
    constructor(private readonly sessions: SessionService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const req = context.switchToHttp().getRequest<Request>();

      // Throws UnauthenticatedError for every reason -- absent, malformed, expired,
      // forged, suspended, deleted. The caller must not be able to tell them apart.
      const user = await this.sessions.authenticate(req.headers.authorization);

      attachCurrentUser(req, user);
      return true;
    }
  }

  return mixin(RequireAuthGuard);
}

/**
 * The caller's role must be one of these.
 *
 * ## This is never sufficient on its own for an `:id` endpoint
 *
 * `docs/SECURITY/04` § Implementation Principle 1, stated as plainly as the document
 * does: "A role check is NEVER sufficient on its own for resource-based (`:id`)
 * endpoints — the role determines the CATEGORY of access, ownership determines the
 * SPECIFIC resource."
 *
 * `requireRole("user")` passes for **every** logged-in user, which is to say it passes
 * for the attacker as readily as for the owner. A route guarded by this and nothing else
 * that then reads `:id` is an IDOR. The service must still go through
 * `requireOwnership`, and `scripts/check-id-endpoint-tests.mjs` fails the build for a new
 * `:id` route without an IDOR test precisely because this mistake looks like security.
 *
 * The role comes from the user the guard above resolved, which came from the database.
 * A token claiming `role: "super_admin"` has no effect (`docs/SECURITY/01`).
 */
export function requireRole(...roles: readonly string[]): Type<CanActivate> {
  if (roles.length === 0) {
    // A guard that permits everything, named as if it restricted something, is worse
    // than no guard: it reads as protection in every review that follows.
    throw new Error("requireRole() needs at least one role.");
  }

  const allowed = new Set(roles);

  @Injectable()
  class RequireRoleGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest<Request>();

      // Throws UnauthenticatedError when `requireAuth()` did not run. A role guard that
      // silently passed an unauthenticated request would be the worst possible failure,
      // so the absence of a user is an error rather than a `false`.
      const user = currentUser(req);

      if (!allowed.has(user.role)) {
        // 403, not 404, and that is correct here: a role is a property of the CALLER.
        // Refusing on it reveals nothing about whether any resource exists, which is the
        // distinction `docs/API/00` § 403 vs 404 draws.
        throw new ForbiddenError();
      }
      return true;
    }
  }

  return mixin(RequireRoleGuard);
}

/** `docs/PLAN/03`: the roles above a plain user. */
export const ADMIN_ROLES = ["admin", "super_admin"] as const;

/** Sugar for the common pair. Same guard, one obvious name. */
export function requireAdmin(): Type<CanActivate> {
  return requireRole(...ADMIN_ROLES);
}
