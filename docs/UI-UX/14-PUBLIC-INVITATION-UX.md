# 14 - Public Invitation UX

## Principles
- A single-page scroll, with no application navigation (100% focus on the invitation content).
- Purely mobile-first (most invitations are opened from a phone via a WhatsApp link).
- Fast loading is UX priority #1 (see FRONTEND/09-PERFORMANCE.md) — a guest's first impression happens within the first few seconds.

## Section Order (Default, may vary per template — determined by `template_version.sections`)
1. **Cover/Hero** — the couple's nicknames, the date, an "Open Invitation" button (if there's an opening animation/cover-gate for dramatic effect & to trigger music autoplay with a user gesture — a modern browser requirement).
2. **Quote** — an opening verse/quote.
3. **Couple** — photos & info about both the bride and groom + parents.
4. **Event** — details for the Akad & Reception, with a countdown to the nearest event.
5. **Gallery** — pre-wedding photos.
6. **Maps** — an interactive map + an "Open in Google Maps" button.
7. **Gift** — a list of bank accounts/e-wallets with a "Copy Number" button.
8. **RSVP** — an attendance confirmation form.
9. **Guestbook** — a list of messages + a form to add a message.
10. **Closing** — a closing thank-you message.

## Key Interactions
- **Guest name personalization** (`?to=Name`): displayed on the Cover ("Dear Mr./Mrs. [Name]") — rendered client-side from the query param, does NOT affect server-side caching of the main page (ARCHITECTURE/06).
- **Countdown**: real-time client-side JS, updates every second, toward the nearest event that hasn't yet passed.
- **Copy account number**: a button with brief "Copied!" feedback.
- **Share**: a WhatsApp button (pre-filled text + link) & Copy Link.
- **Background music** (if the section is active): a floating mute/unmute button, default state per the browser's autoplay policy (usually requires the user's first interaction).

## Accessibility
- Sufficient text contrast even over a photo background (a gradient overlay if needed) — see 17-ACCESSIBILITY.md.
- All buttons & forms are accessible via keyboard/screen reader even with a decorative visual design.

## Special States
- `expired`/not-found invitation: a simple fallback page, not a technical error — a friendly tone ("This invitation is no longer accessible").
- Watermark: with a single paid package that carries no watermark (PLAN/09, ADR-023), a watermark appears **only** on a free draft's preview and on a share-preview link — never on a published invitation. `display.watermark` in the public API response (API/08) is therefore false for every published invitation at MVP; the field stays because the rule is a package property, not a constant. If a footer credit link is wanted as an acquisition channel, that is a separate, deliberate decision rather than a side effect of the package tier.
