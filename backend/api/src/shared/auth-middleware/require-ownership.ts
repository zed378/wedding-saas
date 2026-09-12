import { NotFoundError } from "../../http/errors";
import { logSecurityEvent } from "../logging/logger";
import type { TenantScope } from "../tenancy/tenant-scope";

/**
 * P1-06 — `requireOwnership(resourceLoader)`, the third name in
 * `docs/SECURITY/04` § Mandatory Middleware.
 *
 * ## Why this is a function and not a guard
 *
 * The document lists it under "Mandatory Middleware" beside `requireAuth` and
 * `requireRole`. Its own Implementation Principle 2 then says:
 *
 * > Ownership checks are performed at the **service layer** (not just the controller), so
 * > no code path can accidentally bypass it when the service is called from elsewhere
 * > (e.g., from a job/worker).
 *
 * A Nest guard runs on an HTTP request and on nothing else. Making this a guard would
 * satisfy the heading and break the principle — and break it invisibly, because the
 * endpoint would still be safe and the worker calling the same service would not be. So
 * it keeps the mandated name and takes the shape the principle requires.
 *
 * ## Why it takes a loader rather than a resource
 *
 * `requireOwnership(resourceLoader)` is the document's own signature, and it is the
 * signature that makes Implementation Principle 3 possible. A function that received a
 * resource would mean the resource had already been fetched — unscoped — and this would
 * be comparing `owner_id` in application code, which principle 3 names as the wrong
 * answer.
 *
 * The loader is expected to be a `P0-11` repository call that already carries
 * `WHERE owner_id = :scope`. This function therefore **never sees a row it has to judge**.
 * It only ever turns `null` into a 404, which means it cannot judge one wrongly.
 *
 * ```ts
 * const invitation = await requireOwnership(
 *   () => this.invitations.findOwned(id, user.scope),
 *   { scope: user.scope, resourceType: "invitation", resourceId: id },
 * );
 * ```
 */

export interface OwnershipContext {
  /** Who was asking. Only used for the security event. */
  readonly scope: TenantScope;
  /** `invitation`, `order`, `media` — whatever the loader was looking for. */
  readonly resourceType: string;
  /** The id that was requested. See the note in § 13 of the spec about logging it. */
  readonly resourceId: string;
}

/**
 * Load a resource that must belong to the caller, or raise a 404.
 *
 * **404, never 403.** `docs/SECURITY/04`'s closing note: "using 404 (not 403) for the
 * 'exists but isn't yours' case is a deliberate design choice to prevent resource
 * enumeration via status-code differences". There is no `ForbiddenError` in this file and
 * there is deliberately no way to reach one — `backend/api/src/http/errors.ts` does not
 * export a forbidden-for-someone-elses-resource error at all (ADR-018), so the mistake
 * cannot be made by accident anywhere in the codebase.
 */
export async function requireOwnership<T>(
  resourceLoader: () => Promise<T | null | undefined>,
  context?: OwnershipContext,
): Promise<T> {
  const resource = await resourceLoader();

  if (resource === null || resource === undefined) {
    if (context !== undefined) {
      // One of these is a stale bookmark. A hundred in a minute with incrementing ids is
      // an attack, and `docs/SECURITY/05` wants that visible. The resource id is included
      // because without it a reviewer cannot tell enumeration from a bad link -- and it
      // is not the caller's data, so logging it reveals nothing of theirs.
      logSecurityEvent("authz.idor_attempt", {
        actor_id: context.scope,
        resource_type: context.resourceType,
        resource_id: context.resourceId,
      });
    }

    // The SAME error as "no such row", because the loader could not tell us which it was
    // and must not be able to.
    throw new NotFoundError();
  }

  return resource;
}

/**
 * The boolean form, for writes that need the proof but not the row.
 *
 * `P0-11`'s `ownsInvitation` is the intended loader: same predicate, no row shipped. A
 * service that fetched a whole row only to discard it invites someone to "optimise" the
 * check away later.
 */
export async function requireOwned(
  owns: () => Promise<boolean>,
  context?: OwnershipContext,
): Promise<void> {
  await requireOwnership(async () => ((await owns()) ? true : null), context);
}
