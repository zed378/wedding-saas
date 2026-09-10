# @wi/public-invite

The public invitation page. Next.js, server-rendered.

**Host**: `invitation.zedth.my.id` — its own hostname, deliberately.

Guest-submitted content renders here: RSVP names and guestbook messages. Keeping this surface
off the application origin means a stored XSS that survives sanitization cannot act against a
logged-in user session (ADR-024 in `MEMORY/DECISIONS.md`, `docs/SECURITY/02`).

## Routes

```
/{slug}             The invitation
/preview/{token}    Share-preview: watermarked, noindex, submissions disabled
/public/*           Proxied to the API — guest RSVP, guestbook, view counter
```

**Everything else on this host is a 404.** With invitations at the root, any other route could
shadow a published invitation and take a live wedding page offline (R15). The reserved path
list is enforced twice: in the proxy, and as rows in `slug_blocklist` with a CI check.

## Why server-rendered

Sharing bots — WhatsApp, Facebook, Telegram — read `og:*` tags without executing JavaScript.
A client-rendered page produces a broken link preview, which is most of how this product is
shared (`docs/FRONTEND/07`).

## Budgets

LCP under 2.5s on simulated 4G, CLS under 0.1, roughly 150KB of JavaScript for the initial load
(`docs/FRONTEND/09`). Enforced in CI. This is why the maps section ships a static image and a
deep link rather than a map SDK (ADR-014).

Commands are wired in `P0-22`.
