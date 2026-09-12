/**
 * P1-06 — the three names `docs/SECURITY/04` § Mandatory Middleware mandates.
 *
 *   requireAuth()                      valid token, live user, injected into the request
 *   requireRole(...roles)              the CATEGORY of access -- never sufficient alone
 *   requireOwnership(resourceLoader)   the SPECIFIC resource -- service layer, 404 on miss
 *
 * The first two are Nest guards. The third is not, and `require-ownership.ts` explains at
 * length why making it one would satisfy the document's heading while breaking its
 * Implementation Principle 2.
 */
export { requireAuth, requireRole, requireAdmin, ADMIN_ROLES } from "./guards";

export {
  requireOwnership,
  requireOwned,
  type OwnershipContext,
} from "./require-ownership";

export {
  CurrentUserParam,
  currentUser,
  maybeCurrentUser,
  attachCurrentUser,
  type CurrentUser,
} from "./current-user";
