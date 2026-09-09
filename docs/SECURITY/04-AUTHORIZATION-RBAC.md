# 04 - Authorization & RBAC

## Role Model (see PLAN/03-USER-ROLES.md for the full matrix)
`guest` (anonymous, no token) → `user` → `admin` → `super_admin`.

## Mandatory Middleware
```
requireAuth()            // valid token, injects current_user
requireRole(...roles)    // current_user.role must be one of the listed roles
requireOwnership(resourceLoader) // resource.owner_id === current_user.id OR admin+ role
```

## Implementation Principles
1. **A role check is NEVER sufficient on its own** for resource-based (`:id`) endpoints — the role determines the CATEGORY of access, ownership determines the SPECIFIC resource. Example: `requireRole('user')` passes for any user, but the handler still MUST call `requireOwnership` before any CRUD operation on a specific `invitation_id`.
2. Ownership checks are performed at the **service layer** (not just the controller), so no code path can accidentally bypass it when the service is called from elsewhere (e.g., from a job/worker).
3. Database queries for a user's own resources should ALWAYS include an `WHERE owner_id = :current_user_id` filter at the query level (not fetch first, then check in the application) — reduces the risk of forgetting the check & is more efficient.
4. For admins who need cross-tenant read access (support), use an explicit separate query (`adminFindInvitation`) different from `findOwnedInvitation`, so it is clear in the code when an ownership bypass occurs — and it MUST be logged in the audit log.

## Example Pseudocode (Service Layer)
```
function getInvitation(invitationId, currentUser) {
  const invitation = db.invitations.findOne({ id: invitationId, deleted_at: null });
  if (!invitation) throw new NotFoundError();
  if (invitation.owner_id !== currentUser.id && !isAdmin(currentUser)) {
    throw new NotFoundError(); // 404, NOT 403, to avoid confirming the resource's existence to a non-owner
  }
  return invitation;
}
```
Note: using 404 (not 403) for the "exists but isn't yours" case is a deliberate design choice to prevent resource enumeration via status-code differences — consistent with API/00-API-STANDARDS.md.

## Fine-Grained Admin (optional Phase 2)
- If the admin team grows larger, consider granular permissions per module (e.g., `template.manage`, `order.refund`, `moderation.act`) instead of a single `admin` role for everything — can be implemented as an `admin_permissions` table without changing the core structure.

## Mandatory Testing
- Every new endpoint that accepts an `:id` MUST have a test case: "User B cannot access User A's resource" as part of the definition-of-done (see TESTING/04-SECURITY-TESTING.md).
