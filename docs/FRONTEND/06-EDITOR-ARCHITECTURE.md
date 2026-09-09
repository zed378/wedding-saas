# 06 - Editor Architecture

Technical detail complementing UI-UX/12-EDITOR-UX.md.

## Data Flow (State ↔ Preview ↔ Server Sync)
```
User input in the Properties Panel
   ↓ (immediate, synchronous)
Update the Editor Store (local state)
   ↓ (immediate, reactive)
Live Preview re-renders from the Editor Store  ← INSTANT, no waiting for the server
   ↓ (debounced 1-1.5s)
Trigger a PATCH API call to the relevant sub-resource
   ↓
saveStatus: 'saving' → success response → 'saved' (with a timestamp)
                       → failure response → 'error' (local state IS PRESERVED, retry is available)
```

## Why Not Fetch-on-Every-Keystroke
- The Live Preview reads from LOCAL (client) state, not from an API round-trip result — this is what makes the preview feel instant (< 300ms per PLAN/17-ACCEPTANCE-CRITERIA.md). The API call (autosave) runs in parallel in the background, not blocking the preview's rendering.

## Conflict Handling (Multi-device/Tab)
- MVP: simple last-write-wins. If, when about to save, the client detects the server's `updated_at` is newer than what the client last knew (e.g., the user edited from 2 tabs), show a non-blocking warning ("Data may have been changed elsewhere") — don't silently overwrite large changes without the user's knowledge.

## Editor Modules
```
EditorProvider (context/store initialization, loads invitation + template data)
  ├── SectionListPanel
  ├── LivePreviewFrame (uses TemplateRenderer mode="live")
  ├── PropertiesPanel (dynamic form from FORM-ARCHITECTURE.md)
  ├── AutosaveManager (hook: debounce, dispatch PATCH, update saveStatus)
  └── PublishFlowController (validation checklist, triggers publish/checkout)
```

## Section Navigation
- Clicking a section in the sidebar → updates `activeSectionKey` in the store → the Properties Panel re-renders fields for that section → the Live Preview scrolls-to (smooth scroll) the corresponding element (using a ref/ID per section in the render output).

## Performance
- The Live Preview is rendered as a regular React component within the same DOM (not a separate iframe) for the MVP — simpler & faster state sync; iframe isolation is only considered if a need for stricter CSS/JS sandboxing arises in the future.
