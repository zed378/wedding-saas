# 02 - Frontend Architecture

For implementation details see FRONTEND/. This document covers high-level architectural decisions.

## Logically Separate Applications
1. **Marketing + Auth + Dashboard + Editor** (authenticated app) — an SPA with client-side routing, optimized for interactivity (real-time editor).
2. **Public Invitation Renderer** — optimized for SEO, fast loading, and share preview (og:image) — using SSR or pre-render on-publish + revalidate-on-update (ISR-style), NOT a pure client-side SPA (see PLAN/15-SEO.md).
3. **Admin Panel** — a separate SPA, separate route/subdomain, RBAC-gated.

All three can reside in a single monorepo with different build targets, or as three separate applications — the technical decision is up to the implementation team, but the functional boundaries above MUST be maintained.

## Key Principles
- **Schema-driven rendering**: both the Editor and the Public Renderer read the `template_definition` to determine which sections & fields to render — there are no hard-coded React/Vue components per individual template (aligned with PLAN/07-TEMPLATE-SYSTEM.md).
- **Shared Component Library**: one set of components (`GalleryGrid`, `EventCard`, etc.) is used across templates, configured via props derived from theme variables.
- **State Management**: see FRONTEND/02-STATE-MANAGEMENT.md — complex editor state (form + preview in sync) requires a centralized state strategy per invitation being edited.
- **Optimistic UI with Autosave**: changes appear instantly in the preview, saved to the server in a debounced manner, with a save-status indicator & simple conflict-resolution fallback (last-write-wins for MVP, with a warning if a change from another device is detected).

## Public Page Rendering Strategy
| Scenario | Strategy |
|---|---|
| First publish | Pre-render/cache the full page |
| User updates content after publish | Invalidate the specific invitation's cache, re-render on next request or proactively regenerate |
| High traffic (viral share) | Serve from CDN cache, high cache-hit ratio is prioritized |

## Mobile-first & Accessibility
- Primary breakpoint: mobile (< 640px) as the design baseline, desktop as an enhancement (see UI-UX/15-RESPONSIVE-DESIGN.md).

## Error Boundaries
- The public invitation page must have a graceful fallback if a template version breaks/a section errors out — it must not crash the entire page (see FRONTEND/08-ERROR-BOUNDARIES.md).
