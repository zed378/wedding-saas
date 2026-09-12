import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TemplateRenderer } from "@wi/template-renderer";

/**
 * P2-02 DoD item 1 — "the renderer is imported by both `frontend/web-app` and
 * `frontend/public-invite` from one package".
 *
 * ## Why this is a test and not a line in a record
 *
 * Both applications already listed `@wi/template-renderer` as a dependency before it had
 * anything in it, so the manifest proves nothing. What is actually at risk is
 * **resolution**: the package is ESM with `"type": "module"` and NodeNext-style `.js`
 * specifiers, and it is consumed by a Next application whose own tsconfig sets
 * `jsx: "preserve"`. That combination has already cost this project a day once — `P1-22`
 * found that esbuild could not parse a `.tsx` here at all without `@vitejs/plugin-react`.
 *
 * A wrong answer looks like "cannot find module" during `P2-05`, a card away from the
 * change that caused it. Proving it now costs one render.
 *
 * The visual work is `P2-03` and the preview wiring is `P2-05`. This asserts the seam,
 * nothing more.
 */
describe("the editor surface can render through the shared package", () => {
  it("imports and renders the same TemplateRenderer the public page uses", () => {
    render(
      <TemplateRenderer
        mode="live"
        invitationData={{ couple: { groom: { nickname: "Budi" } } }}
        templateVersion={{
          sections: [
            {
              section_key: "hero",
              component: "HeroClassic",
              enabled_by_default: true,
              configurable: false,
              required_fields: ["couple.groom.nickname"],
            },
          ],
          theme: { colors: { primary: "#b76e79" } },
        }}
      />,
    );

    const root = document.querySelector<HTMLElement>(
      "[data-template-renderer]",
    );
    expect(root).not.toBeNull();
    // `live` is the editor's mode: local state, no submissions, no view counter.
    expect(root?.getAttribute("data-mode")).toBe("live");
    expect(
      document.querySelector('[data-section="hero"]')?.textContent,
    ).toContain("Budi");
  });
});
