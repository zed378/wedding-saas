import "@testing-library/jest-dom/vitest";

/**
 * P1-20 — the web app's test environment.
 *
 * Deliberately thin. The only thing that needs stubbing is `next/navigation`, and that is
 * done per-file rather than globally: a global router stub makes every test depend on a
 * shared fiction, and the first test that needs different behaviour has to fight it.
 */
