# 03 - User Roles

| Role | Description | Primary Access |
|---|---|---|
| `guest` (anonymous) | Visitor to the public invitation page | Read public invitation, submit RSVP, submit guestbook |
| `user` | Registered account owner (bride/groom or WO) | CRUD on their own invitations, upload their own media, order/payment, publish/unpublish |
| `admin` | Internal platform staff | CRUD templates & versions, manage users, manage orders (view, manual refund), content moderation, access to all invitations (read, limited write for moderation) |
| `super_admin` (optional Phase 2) | Admin with system configuration access | All admin access + manage other admin roles, payment gateway configuration, feature flags |

## Authorization Principles
- Role is stored in the `users.role` table (enum), validated on every request via RBAC middleware (see SECURITY/04-AUTHORIZATION-RBAC.md).
- Object-level authorization is MANDATORY for every endpoint that accepts an `:id` — check `owner_id == current_user.id` OR `role in (admin, super_admin)`, not just a role check.
- No implicit combined roles — `admin` does not automatically gain `super_admin` access.

## Access Matrix Summary (full detail in SECURITY/04)
| Resource | guest | user (owner) | user (non-owner) | admin |
|---|---|---|---|---|
| Draft invitation | - | CRUD | - | R |
| Published invitation (public) | R | CRUD | R (public) | R |
| Media | - | CRUD | - | R |
| Order/Payment | - | CR (own) | - | RU (refund) |
| Template | R (catalog) | R | R | CRUD |
| RSVP/Guestbook (submit) | C | - | - | - |
| RSVP/Guestbook (manage) | - | RUD (own) | - | R |
