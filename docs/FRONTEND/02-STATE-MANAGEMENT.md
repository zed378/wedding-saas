# 02 - State Management

## State Categories
| Category | Example | Strategy |
|---|---|---|
| Server state (remote data) | invitation data, template catalog, order status | A data-fetching library with caching (e.g., TanStack Query/SWR) — not manual fetch+useState |
| Client/UI state | modal open, active tab, temporary form input | Local component state / a lightweight store (e.g., Zustand) |
| Editor state (complex) | the draft invitation being edited, active section, dirty-tracking | A centralized store per editor session (see 06-EDITOR-ARCHITECTURE.md) |
| Auth state | current user, token | A global, persisted (securely) store |

## Principles
- **Don't duplicate the source of truth**: the editor's invitation data has ONE centralized store; the Live Preview & Properties Panel components read from the same store, not through multi-level manual prop-drilling that easily goes out of sync.
- **Server state should never be stale unknowingly**: use explicit cache invalidation after a mutation (create/update/delete) — e.g., after `PATCH /invitations/:id`, invalidate that invitation's query cache.
- **Optimistic updates for a responsive UX**: form changes in the editor are immediately reflected in local state/preview BEFORE server confirmation (autosave runs in the background) — see 06-EDITOR-ARCHITECTURE.md for rollback details if the save fails.

## Auth Token Storage
- Access token: in-memory (JS store), NEVER in localStorage (mitigating XSS token theft — see SECURITY/03).
- Refresh token: an HTTP-only cookie (never accessible to JS at all).

## Editor State Shape (indicative)
```ts
type EditorState = {
  invitationId: string;
  data: InvitationData;        // structure per PLAN/08
  templateDefinition: TemplateVersion;
  activeSectionKey: string;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  dirtyFields: Set<string>;
};
```
