# 00 - Frontend Standards

## Stack (recommended, framework-agnostic)
- Framework: React (Next.js recommended for the SSR/ISR needs of the Public Invitation — see 07-PUBLIC-INVITATION.md) or an equivalent Vue/Nuxt setup.
- Styling: utility-first CSS (Tailwind) + design tokens from UI-UX/06-DESIGN-SYSTEM.md.
- State management: see 02-STATE-MANAGEMENT.md.
- TypeScript is mandatory (type-safety for the frequently-changing, complex template schema shape).

## Project Structure (indicative)
```
apps/
  web-app/        (marketing + auth + dashboard + editor + admin, or a separate admin app)
  public-invite/  (public page renderer, SSR/ISR)
packages/
  ui/             (design system component library)
  template-renderer/  (invitation section component library, shared between editor preview & public-invite)
  api-client/     (typed client for the Backend API)
  schema/         (TypeScript types generated from the template schema & invitation data model)
```

## Code Conventions
- Components: PascalCase, one component per file.
- Custom hooks: prefixed with `use`.
- No hard-coded per-template field/section strings (see 04-TEMPLATE-RENDERING.md) — everything is schema-driven.

## Linting & Formatting
- ESLint + Prettier mandatory, enforced in CI (a PR fails if there's a lint error).
- Consistent import order (external → internal alias → relative).

## Testing
- See 10-TESTING.md for the frontend unit/integration/e2e testing strategy.

## Environment Config
- All configuration (API base URL, feature flags) via environment variables, not hard-coded, and no `.env` files containing secrets committed to the repo.
