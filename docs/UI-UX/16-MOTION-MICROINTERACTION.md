# 16 - Motion & Microinteraction

## Principles
- Motion should be functional, not overly decorative in the application (chrome) — short duration (150-250ms), standard easing (ease-out for entering, ease-in for exiting).
- Invitation templates may have more expressive motion (a cover-opening animation, gallery parallax) since that's part of the "wow factor" of a consumer product — defined per template, not part of this application's design system.

## Key Microinteractions (Application)
| Interaction | Motion |
|---|---|
| Autosave status change | Brief fade/slide of the status text |
| Toast notification | Slide-in from the top/bottom, auto-dismiss after 3-4 seconds |
| Toggle switch (section on/off) | Color + position transition ~150ms |
| Upload progress | Smooth progress bar, animated checkmark on completion |
| Drag reorder photos | A ghost element follows the cursor/finger, a slight bounce on drop |
| Copy to clipboard (bank account) | The icon briefly turns into a checkmark + a "Copied!" tooltip |
| Modal open/close | Fade + slight scale (98%→100%) |
| Loading skeleton | A gentle shimmer effect |

## Public Page Microinteractions
- Countdown numbers: a smooth transition every second (not a jarring jump).
- Scroll reveal per section (fade-up as an element enters the viewport) — optional per template, must have a `prefers-reduced-motion` fallback (accessibility — see 17-ACCESSIBILITY.md).

## Prohibitions
- No motion should block user interaction (e.g., a mandatory animation that must finish before a button becomes clickable), except for the cover-gate opening, which is intentionally part of the invitation UX by design and can be skipped.
