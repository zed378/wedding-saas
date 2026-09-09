# 01 - Design Principles

1. **Clarity over cleverness** — clear labels & actions, avoid ambiguous icons without text labels for important actions.
2. **Instant feedback** — every action (save, upload, submit) gives immediate visual feedback (loading state, success toast, inline error) — crucial for editor autosave so the user trusts their data is saved.
3. **Reversible actions** — destructive actions (delete a photo, delete an event) always have confirmation or a brief undo; very destructive actions (delete an invitation) require explicit confirmation by retyping the name/slug.
4. **Consistency** — the same components & interaction patterns throughout the app (the primary button is always on the right in a multi-button form, etc.) — see 06-DESIGN-SYSTEM.md.
5. **Accessible by default** — color contrast, touch target size, keyboard navigation are not an afterthought (17-ACCESSIBILITY.md).
6. **Progressive disclosure** — hide advanced complexity (advanced theme options, add-ons) behind an expansion/tab, show a sensible default first.
7. **Empty states that guide** — every empty state (no photos yet, no RSVPs yet) provides a clear call-to-action, not just "no data."
8. **Perceived performance** — skeleton loading, optimistic UI for the editor (don't wait for a server round-trip before updating the preview).
9. **Mobile parity for core features** — users must be able to complete core flows (checkout, viewing incoming RSVPs) from mobile even though detailed editing is more comfortable on desktop.
10. **Never make the user guess payment status** — order/payment status is always displayed explicitly (pending/success/failed), never ambiguous (aligned with SECURITY/07 — server-driven truth, the UI only displays it).
