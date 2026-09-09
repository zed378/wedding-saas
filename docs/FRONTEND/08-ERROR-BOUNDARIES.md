# 08 - Error Boundaries

## Principle
A failure in one part of the UI MUST NOT break/blank-screen the entire page, especially the Public Invitation (seen by many guests) and the Editor (losing a user's work progress is very costly).

## Boundary Levels
```
App Root Boundary        → fallback: a general error page + a "Reload" button + logged to error tracking
  └── Route Boundary       → fallback: a context-specific message (e.g., "Failed to load the invitation")
       └── Section Boundary (TemplateRenderer per section) → fallback: that section is hidden/shows a minimal placeholder,
                                                                  other sections render normally
```

## Public Invitation
- An error in one section (e.g., corrupted gallery data) → only that section falls back (hidden or shows a subtle placeholder), other sections (Event, RSVP, etc.) continue functioning normally — crucial because RSVP/event info is the most important function and must never disappear because another section broke.
- A total error (invitation data fetch fails) → a clear fallback page with a refresh option, NOT a blank white screen.

## Editor
- An error in the Live Preview rendering MUST NOT remove the Properties Panel/form data — the user must still be able to edit & data must still be saved even if the visual preview temporarily fails to render.
- Autosave failure is shown clearly (see UI-UX/12) with a retry, not a silent failure.

## Logging
- Every error caught by a boundary is sent to an error tracking service (e.g., Sentry) with context (invitation_id, section_key, user_id if available) for investigation — WITHOUT including sensitive data (bank account numbers, etc.) in the error log payload (aligned with SECURITY/09).

## Global Fetch Error Handling
- The API client (packages/api-client) has a centralized interceptor: 401 → trigger a token refresh flow or redirect to login; 5xx → a generic "Something went wrong, please try again" toast; network error → an offline indicator.
