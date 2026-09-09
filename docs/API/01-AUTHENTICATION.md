# 01 - Authentication API

## Endpoints
```
POST   /api/v1/auth/register          { email, password, full_name }
POST   /api/v1/auth/login             { email, password }
POST   /api/v1/auth/oauth/google      { id_token }
POST   /api/v1/auth/refresh           { refresh_token }  (ideally via an HTTP-only cookie)
POST   /api/v1/auth/logout
POST   /api/v1/auth/verify-email      { token }
POST   /api/v1/auth/resend-verification
POST   /api/v1/auth/forgot-password   { email }
POST   /api/v1/auth/reset-password    { token, new_password }
GET    /api/v1/auth/me                (returns the current user's profile)
```

## Registration Flow
1. `POST /auth/register` → create a user with status `unverified`, send a verification email (async job).
2. Users can log in & use draft invitations WITHOUT verification (so as not to block product exploration), but `publish` and `checkout` REQUIRE `email_verified = true` (business rule, validated in the publish/order service).
3. `POST /auth/verify-email` with the token from the email → sets `email_verified = true`.

## Token Strategy
- **Access token**: JWT, short expiry (15 minutes), containing `user_id`, `role`, `email_verified`.
- **Refresh token**: an opaque random string, stored hashed in the DB, sent as an HTTP-only + Secure + SameSite=Lax cookie, long expiry (30 days), rotated on every use (the old refresh token is invalidated).
- Full security details: SECURITY/03-AUTHENTICATION-SECURITY.md.

## Google OAuth
- The frontend obtains an `id_token` from the Google Sign-In SDK, sends it to the backend.
- The backend verifies the `id_token` with Google, matches/registers a user based on the verified Google email (auto `email_verified = true`).

## Example Response (successful login)
```json
{
  "success": true,
  "data": {
    "access_token": "eyJ...",
    "user": { "id": "uuid", "email": "a@b.com", "full_name": "...", "role": "user", "email_verified": true }
  }
}
```

## Error Cases
- 401 `INVALID_CREDENTIALS` — wrong email/password (a generic message, does not distinguish "email doesn't exist" vs "wrong password" to prevent user enumeration).
- 429 `TOO_MANY_ATTEMPTS` — rate limit for consecutive failed logins (see SECURITY/10).
- 403 `EMAIL_NOT_VERIFIED` — on endpoints that require verification (publish, checkout).
