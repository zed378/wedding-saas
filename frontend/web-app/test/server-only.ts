/**
 * A stand-in for Next's `server-only` package under Vitest.
 *
 * The real module exists to make a client-side import a build error; there is no runtime
 * behaviour to reproduce. Aliased in `vitest.config.ts`.
 */
export {};
