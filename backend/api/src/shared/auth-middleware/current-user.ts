import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import { UnauthenticatedError } from "../../http/errors";
import { tenantScope, type TenantScope } from "../tenancy/tenant-scope";
import type { AuthenticatedUser } from "../../modules/auth/session.service";

/**
 * P1-06 — the current user, and where it lives on a request.
 *
 * `docs/SECURITY/04` § Mandatory Middleware: `requireAuth()` "injects current_user".
 * This file is the injection point and the one place that reads it back.
 *
 * The property is a symbol rather than a string key. That is not decoration: `req.user`
 * is a name half the Express ecosystem writes to, and a passport strategy, a logging
 * middleware or a future library setting it would silently become an authentication
 * source. A symbol nothing else holds cannot be set by accident.
 */

const CURRENT_USER = Symbol("currentUser");

/** What `requireAuth` attaches. The row, read from the database, not the token. */
export interface CurrentUser extends AuthenticatedUser {
  /**
   * The same id, branded for `P0-11`'s repositories.
   *
   * Carried here so a service never has to call `tenantScope()` on something it hopes is
   * a user id. The only way to obtain one is to have been authenticated.
   */
  readonly scope: TenantScope;
}

export function attachCurrentUser(req: Request, user: AuthenticatedUser): void {
  (req as unknown as Record<symbol, unknown>)[CURRENT_USER] = {
    ...user,
    scope: tenantScope(user.id),
  } satisfies CurrentUser;
}

/**
 * Read the current user off a request.
 *
 * Throws rather than returning `undefined`. A caller that received `undefined` would have
 * to decide what to do about it, and the tempting decision -- carry on unscoped -- is the
 * one this whole subsystem exists to prevent. If this throws, a route is missing
 * `requireAuth()`, which is a bug to fix rather than a case to handle.
 */
export function currentUser(req: Request): CurrentUser {
  const user = (req as unknown as Record<symbol, unknown>)[CURRENT_USER];

  if (user === undefined) {
    throw new UnauthenticatedError();
  }
  return user as CurrentUser;
}

/** Whether a request has been authenticated, without throwing. For optional-auth routes. */
export function maybeCurrentUser(req: Request): CurrentUser | undefined {
  return (req as unknown as Record<symbol, unknown>)[CURRENT_USER] as
    CurrentUser | undefined;
}

/**
 * `@CurrentUser()` — the parameter decorator controllers use.
 *
 * ```ts
 * @Get(":id")
 * @UseGuards(requireAuth())
 * async get(@Param("id") id: string, @CurrentUser() user: CurrentUser) { … }
 * ```
 *
 * It throws when the route has no `requireAuth()` guard, so the failure is loud and
 * immediate rather than a handler quietly receiving `undefined` and querying unscoped.
 */
export const CurrentUserParam = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUser =>
    currentUser(ctx.switchToHttp().getRequest<Request>()),
);
