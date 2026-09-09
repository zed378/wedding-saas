# 17 - Accessibility

## Target
WCAG 2.1 Level AA for the application (editor, dashboard, admin) and best-effort for the public invitation page (given the template's decorative visual nature, the following baseline criteria must still be met and never sacrificed for aesthetics).

## Mandatory Criteria
- **Color contrast**: normal text ≥ 4.5:1, large text (≥18px bold/24px regular) ≥ 3:1 against the background (including text over a photo — use an overlay).
- **Keyboard navigation**: all app interactions (forms, modals, dropdowns) must be fully operable via keyboard (Tab, Enter, Esc), including drag-drop photo reordering, which must have a keyboard alternative (e.g., up/down buttons).
- **Focus indicator**: clearly visible (outline/ring) on the element currently in keyboard focus, not removed via `outline: none` without a replacement.
- **Form labels**: every input has an associated `<label>` (not just a placeholder as the label).
- **Alt text**: all meaningful images have descriptive alt text; purely decorative images use `alt=""`.
- **Semantic HTML**: correct heading hierarchy (`h1`→`h2`→etc.), landmark regions (`nav`, `main`, `footer`).
- **Screen reader**: form errors are announced (`aria-live`/`aria-describedby`), toast notifications have `role="status"`/`role="alert"` as appropriate for their urgency.
- **Touch target**: minimum 44x44px (09-SPACING-GRID.md).
- **prefers-reduced-motion**: non-essential animations are disabled/reduced for users with this OS preference set.

## Areas of Special Attention
- **Editor Live Preview**: the preview iframe/embed must still be skippable via keyboard (a skip-link) so keyboard-only users don't get trapped in a long tab-order inside the preview when trying to reach the Properties Panel.
- **Public RSVP/Guestbook form**: the most important to make accessible since it's used by the general public (including elderly users, e.g., the Mrs. Ratna persona) — sufficiently large default font size (min 16px body), not too many required fields.

## Testing
- Automated: axe-core/Lighthouse accessibility audit in CI for key pages.
- Manual: end-to-end keyboard-only navigation for the Editor & Checkout flows; a screen reader test (NVDA/VoiceOver) at minimum for the public page & RSVP form before launch.
