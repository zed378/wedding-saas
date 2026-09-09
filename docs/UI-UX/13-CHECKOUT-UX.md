# 13 - Checkout UX

## Package Page

There is **one package** at MVP (PLAN/09, ADR-023), so this page does not ask the user to choose — it tells them what they get and what it costs, and gets out of the way. A comparison table with one column is worse than no comparison table.

- A single card: price (Rp 139,000), active period (12 months), what is included (200 photos, no watermark, RSVP, guestbook, gallery, maps, gift).
- No add-on checkboxes at MVP — no addon is active. The layout should accommodate them returning later without redesign, since `addon_ids` is already part of the order.
- A price summary is still shown before the pay action, because PLAN/17 and UI-UX/18 require the user to understand exactly what they are paying for before committing — that requirement does not depend on there being a choice.
- If a second tier is ever introduced, this page becomes comparison cards and the price summary becomes live; nothing else changes.

## Confirmation & Payment Page
- Final summary: invitation name, chosen package, add-ons, total price.
- Payment method options (bank VA, e-wallet, QRIS) — official provider logos for trust signaling.
- A "Pay Now" button → redirects/embeds the provider's widget.

## Awaiting Payment Page
- After redirecting back from the gateway to the app: show a "Verifying payment..." state with status polling (see API/07), NEVER immediately claiming success from a URL parameter.
- A reasonable timeout (e.g., 60-second polling) before showing a "Still being processed, we'll email you once it's done" fallback message in case the webhook is delayed.

## Success Page
- A clear visual confirmation (checkmark icon, order summary), a "Publish Now" continue button.
- Invoice download info available.

## Failed/Expired Page
- A clear message stating the reason (if known from the provider) + a "Try Paying Again" button (creates a new order).

## Error Handling UX
- If payment initiation fails (API error, provider down): a friendly message suggesting they try again shortly, not a raw technical message.
