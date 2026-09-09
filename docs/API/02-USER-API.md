# 02 - User API

All endpoints below require authentication; scope is `self` (current user) only, except where noted as admin.

```
GET    /api/v1/users/me                     Current user's profile
PATCH  /api/v1/users/me                     { full_name, phone } profile update
POST   /api/v1/users/me/change-password     { old_password, new_password }
GET    /api/v1/users/me/notification-preferences
PATCH  /api/v1/users/me/notification-preferences  { rsvp_email: bool, ... }
DELETE /api/v1/users/me                     Request account deletion (soft-delete + confirmation email)
```

## Object-Level Authorization
- All the endpoints above operate ONLY on `current_user.id` from the token — they do NOT accept a `user_id` from the client as a parameter determining the target (preventing IDOR by design). See SECURITY/05.

## Admin User Endpoints
See 09-ADMIN-API.md for `GET /admin/users`, `PATCH /admin/users/:id/suspend`, etc.

## Validation
- `phone`: Indonesian format (optional +62/0 prefix), validated in BACKEND/03-VALIDATION.md.
- `full_name`: 2-100 characters, sanitized against HTML/script.

## Example Response
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "full_name": "Andi Wijaya",
    "phone": "+6281234567890",
    "role": "user",
    "email_verified": true,
    "created_at": "2026-01-05T02:00:00Z"
  }
}
```
