// @wi/schema
//
// Zod schemas, the canonical field-path registry, and the dot-notation resolver.
// Imported by the API (publish validation, docs/BACKEND/03) and by the frontends
// (the editor form and completeness checklist, docs/FRONTEND/03). One definition,
// so the two cannot drift — this is the reason the stack is one language (ADR-004).
//
// Populated by P0-20. The constant below exists so that the cross-package import is
// proven to resolve and compile from day one, rather than being assumed until P0-20.

export const PACKAGE_NAME = "@wi/schema" as const;

/** Marker used by the API skeleton to assert the shared-package import works. */
export const SCHEMA_CONTRACT_VERSION = 0 as const;
