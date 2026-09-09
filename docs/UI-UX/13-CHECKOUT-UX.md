# 13 - Checkout UX

## Package Selection Page
- Comparison cards (Basic vs. Premium), highlighting different features (photo count, watermark, custom domain, active period).
- Add-ons as separate checkboxes below the package selection (e.g., "+Custom Domain Rp X").
- A real-time price summary in a sidebar/bottom-sticky area (subtotal, total) as the user changes their selections.

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
