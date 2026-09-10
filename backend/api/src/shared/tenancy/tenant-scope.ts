/**
 * The tenant scope: whose data a query is allowed to see.
 *
 * It is a *branded* type rather than a bare string, and that is the whole point. A
 * repository method that took `userId: string` would accept an invitation id, a slug,
 * a request parameter, or an empty string with no complaint — and an empty string in a
 * `WHERE owner_id = $1` is not a full-table read, but a mistyped id from the wrong
 * variable very much can be a read of the wrong tenant's row.
 *
 * With a brand, only `tenantScope()` can produce one, so every call site has to have
 * passed through the one function that validates the shape. Everything else is a
 * compile error rather than a silent authorization hole.
 *
 * `docs/SECURITY/05` is the project's number one security priority with zero tolerance
 * for regressions. This file exists so that the correct query is the only one the type
 * system will let you write.
 */

declare const TenantScopeBrand: unique symbol;

/** A validated user id, usable as an ownership filter. Construct with `tenantScope()`. */
export type TenantScope = string & { readonly [TenantScopeBrand]: true };

/** Raised when a scope is constructed from something that cannot be a user id. */
export class InvalidTenantScopeError extends Error {
  constructor(received: unknown) {
    super(
      `Tenant scope must be a UUID user id, received: ${
        typeof received === "string"
          ? JSON.stringify(received)
          : typeof received
      }. A query scoped to an invalid owner is a query nobody meant to write.`,
    );
    this.name = "InvalidTenantScopeError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Build a tenant scope from an authenticated user's id.
 *
 * Throws rather than returning null: there is no sensible way to continue a
 * tenant-scoped query without a tenant, and a caller that swallowed a null would end up
 * choosing between crashing and querying unscoped.
 */
export function tenantScope(userId: string): TenantScope {
  if (typeof userId !== "string" || !UUID.test(userId)) {
    throw new InvalidTenantScopeError(userId);
  }
  return userId as TenantScope;
}

/**
 * A deliberate, audited bypass of tenant isolation.
 *
 * `docs/SECURITY/05` § Special Case allows admin support access through a separate code
 * path, and requires **every** use to be logged. The required `reason` is not
 * decoration: it is what an incident reviewer reads six months later when deciding
 * whether a bypass was legitimate, and asking for it at the call site is the only
 * moment anyone actually knows.
 */
export interface AdminBypass {
  /** The acting admin's user id. Written to `audit_logs.admin_id`. */
  readonly adminId: TenantScope;
  /** Why isolation is being bypassed. Written to `audit_logs.reason`. */
  readonly reason: string;
}

/** Raised when an admin bypass is attempted without a usable reason. */
export class MissingBypassReasonError extends Error {
  constructor() {
    super(
      "An admin tenant-isolation bypass requires a non-empty reason (docs/SECURITY/05 § Special Case). " +
        "The audit row is the only record that the bypass was legitimate.",
    );
    this.name = "MissingBypassReasonError";
  }
}

export function adminBypass(adminId: string, reason: string): AdminBypass {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new MissingBypassReasonError();
  }
  return { adminId: tenantScope(adminId), reason: reason.trim() };
}
