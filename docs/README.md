# Product Documentation — Digital Wedding Invitation Platform

This documentation is ready for execution by Claude Code (or an engineering team) to build the product from scratch. A total of 122 documents across 10 categories.

The **execution plan** built from these documents lives in `../TASKS/`, and the record of what was actually built lives in `../MEMORY/`. `docs/` is reference material: it is amended deliberately, through the deviation protocol in `TASKS/00-TASK-CONVENTIONS.md`, never edited as a side effect of implementation.

## Recommended Reading Order
```
1. PLAN/00-PROJECT-OVERVIEW.md          → start here for the big-picture context
2. PLAN/01-PRODUCT-REQUIREMENTS.md
3. PLAN/02-BUSINESS-RULES.md
4. PLAN/08-INVITATION-DATA-MODEL.md      → the core domain model (most frequently referenced by other docs)
5. PLAN/07-TEMPLATE-SYSTEM.md            → the data-driven template concept (critical)
6. PLAN/06-INVITATION-LIFECYCLE.md
7. ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md
8. DATABASE/00-DATA-MODEL.md → 12-PLATFORM-CONFIG.md
9. API/00-API-STANDARDS.md → 09-ADMIN-API.md
10. SECURITY/00-SECURITY-REQUIREMENTS.md → 12-INCIDENT-RESPONSE.md (SECURITY/05-MULTI-TENANCY-SECURITY.md in particular is mandatory reading for every engineer)
11. UI-UX/, FRONTEND/, BACKEND/, DEVOPS/, TESTING/ as needed per work phase
```

## Folder Structure
```
PLAN/          19 files — product vision, requirements, business rules, roadmap
ARCHITECTURE/  10 files — high-level system design
API/           10 files — the complete API contract
DATABASE/      13 files — SQL schema ready for migration
SECURITY/      13 files — threat model through incident response (read SECURITY/05 and SECURITY/06 very carefully)
UI-UX/         19 files — experience design & the design system
FRONTEND/      11 files — frontend architecture & standards
BACKEND/       10 files — backend architecture & standards
DEVOPS/         9 files — CI/CD, deployment, observability
TESTING/        8 files — the complete testing strategy
```

## Core Design Principles Binding All Documents
1. **Invitation is the data domain**, **Template is a versioned presentation layer** on top of it (PLAN/07, PLAN/08).
2. **Multi-tenant isolation is security priority #1** — zero tolerance for cross-user data leaks (SECURITY/05).
3. **Payment status only ever comes from the server, never from the client** (SECURITY/07).
4. **All documents cross-reference each other explicitly** — follow the cross-references to get the full context before implementation.

## How to Use This with Claude Code
Direct Claude Code to read `PLAN/`, `DATABASE/`, `API/`, and `SECURITY/05` first before writing any code, then follow the phase order in `PLAN/16-IMPLEMENTATION-ROADMAP.md`.
