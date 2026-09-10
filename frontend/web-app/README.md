# @wi/web-app

Marketing, template catalogue, authentication, dashboard, editor and checkout. Next.js.

**Host**: `app.zedth.my.id`.

**Governed by**: `docs/FRONTEND/` (standards, routing, state, forms, editor),
`docs/UI-UX/` (design system, editor UX, checkout UX).

The editor is the most complex surface in the product: a schema-driven form, a live preview
rendered from local state, and debounced autosave, all reading one store (`docs/FRONTEND/06`).
The preview uses `@wi/template-renderer` — the same code the public page runs, which is what
makes it a real preview rather than an approximation.

Two constraints worth knowing before writing anything here:

- **The access token is held in memory only.** Never `localStorage`, never `sessionStorage`
  (`docs/FRONTEND/02`). The refresh token is an HTTP-only cookie the frontend cannot read.
- **No section key or field path is hard-coded.** Forms are generated from the template schema
  and the field registry in `@wi/schema`. Hard-coding per template defeats the template system,
  which is the product's central architectural decision.

Commands are wired in `P0-22`.
