# 12 - Editor UX (The Most Important Frontend Document)

The most complex part of the product — combining a complex form + live preview + real-time autosave.

## Desktop Layout
```
┌──────────────────────────────────────────────┐
│ Logo   [Invitation Name]        Status: Saved │
├──────────┬───────────────────────┬───────────┤
│ Sections │                       │ Properties│
│          │                       │           │
│ Hero     │                       │ Name      │
│ Couple   │                       │ Photo     │
│ Event    │     LIVE PREVIEW       │           │
│ Gallery  │     (mobile frame)     │ Text      │
│ Maps     │                       │           │
│ Gift     │                       │           │
│ RSVP     │                       │           │
│ ...      │                       │           │
├──────────┴───────────────────────┴───────────┤
│ [Toggle Mobile/Desktop Preview]   [Publish]   │
└──────────────────────────────────────────────┘
```

## Mobile Layout
- The 3 columns above become a tab mode: `Sections` (bottom sheet list) ↔ `Preview` (default view, full screen) ↔ `Edit` (a form appears as a bottom sheet/modal when a section is selected).
- Mobile priority: the Preview must always be quickly accessible (1 tap from anywhere).

## Section List (Left)
- Section order = the order sections appear in the invitation (following the `template_version.sections` order — this order CANNOT be changed by the user at MVP, only toggling on/off for `configurable: true` sections).
- Indicator per section: ✓ (complete), ⚠ (has an empty required field), toggle switch (if configurable).

## Live Preview (Center)
- Renders using the SAME components as the public page (a shared component library, see FRONTEND/04) — a genuine WYSIWYG experience, not a simplified mockup.
- Updates the preview instantly from local state as the user types (client-side, without waiting for the API) — see FRONTEND/06-EDITOR-ARCHITECTURE.md for the technical detail of state↔preview↔autosave synchronization.

## Properties Panel (Right)
- A dynamic form based on the fields of the active section. Required fields are marked (*), optional fields have helper text about when it's a good idea to fill them in.
- For photo fields: a drag-drop zone + crop preview, with an upload progress indicator.
- For map fields: an interactive mini-map + a text address input with location auto-search.

## Autosave & Status Indicator
- 1-1.5 second debounce after the user stops typing/making changes.
- A status indicator in the header: "Saving..." → "Saved" (with a relative timestamp, e.g., "Saved 2 seconds ago") → if it fails: "Failed to save, try again" (with a manual retry button + no loss of changes in local state).

## Changing Templates from the Editor
- A "Change Template" button in the header/menu → follows the flow in UI-UX/05-USER-FLOWS.md § Change Template Flow.

## Publish CTA
- The "Publish" button is always visible (sticky), disabled with a tooltip explaining why if a required field is empty (not hidden — the user should always know the button exists and understand why they can't click it yet).
