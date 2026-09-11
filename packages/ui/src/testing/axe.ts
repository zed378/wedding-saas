import axe, { type AxeResults, type RunOptions } from "axe-core";

/**
 * P0-22 — the accessibility check every component test runs.
 *
 * `docs/UI-UX/17` § Testing asks for an axe audit; the DoD asks for it per component.
 * Running it here, in jsdom, rather than only over an assembled page means a component
 * that loses its label association fails in its own test file — where the person who
 * broke it is already looking.
 *
 * ## What this cannot do
 *
 * jsdom has no layout engine, so **`color-contrast` cannot run** — every element has
 * zero size and no computed colour. That is not a small gap: `docs/UI-UX/08` requires
 * 4.5:1 on every text-background pair. It is covered instead by
 * `token-contrast.spec.ts`, which computes the ratios from the token values directly,
 * and by the E2E axe pass over the real workbench page (`P0-19`'s harness).
 *
 * Naming the gap here rather than letting a green test imply coverage it does not have.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export interface Violation {
  readonly id: string;
  readonly help: string;
  readonly nodes: number;
}

export async function findViolations(
  container: Element,
  options: RunOptions = {},
): Promise<Violation[]> {
  const results: AxeResults = await axe.run(container, {
    runOnly: { type: "tag", values: WCAG_TAGS },
    // Cannot run without layout. See the note above.
    rules: { "color-contrast": { enabled: false } },
    ...options,
  });

  return results.violations.map((v) => ({
    id: v.id,
    help: v.help,
    nodes: v.nodes.length,
  }));
}

/** Assert-friendly: an empty array reads well in a failure message. */
export async function axeViolationIds(container: Element): Promise<string[]> {
  return (await findViolations(container)).map((v) => `${v.id}: ${v.help}`);
}
