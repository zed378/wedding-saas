# 06 - Cross-Browser & Device Testing

## Mandatory Test Matrix
| Category | Target |
|---|---|
| Desktop Browser | Chrome (latest), Safari (latest), Firefox (latest), Edge (latest) |
| Mobile Browser | Chrome on Android, Safari on iOS |
| Mobile Device (representative of the Indonesian market) | A mid-range Android device (viewport ~360x800, simulated 4G connection), a standard iPhone (390x844) |
| OS | Android 10+, iOS 15+ |

## Testing Focus per Page
- **Public Invitation**: HIGHEST priority for cross-device (accessed by the widest range of devices/general guests) — verify the layout isn't broken, photos load, the countdown is accurate, the RSVP form can be submitted, the maps/WA buttons work (deep-linking).
- **Editor**: priority on desktop (Chrome, Safari, Firefox, Edge) since it's mainly used from a desktop/laptop; also verify tablet mode (iPads are commonly used for creative work).
- **Checkout/Payment**: verify the payment gateway widget/redirect works correctly across all browsers & devices (including in-app browsers from WhatsApp/Instagram, often used to open links — a special case that sometimes has issues with popups/redirects).

## Common Issues Explicitly Tested
- In-app browsers (a WebView from WhatsApp/Instagram) often block popups/certain payment gateway redirects → verify the checkout flow still works or has a fallback ("Open in Browser") if an in-app browser is detected.
- Safari on iOS: autoplay behavior for music/video differs from Chrome — verify the background music UX (UI-UX/14) is still good (a manual unmute button as a fallback).
- Font rendering & native date/time pickers differ across browsers — verify the Editor form remains consistent.

## Tools
- Automated: BrowserStack/Sauce Labs for a basic automated matrix (visual + functional smoke test).
- Manual: physical representative devices for UAT sessions before major releases.

## Cadence
- Full matrix: before the MVP launch & every major release (significant changes to the Editor/Public Invitation).
- Smoke subset (Chrome + Safari mobile): every staging deploy (automated, part of the CI E2E test).
