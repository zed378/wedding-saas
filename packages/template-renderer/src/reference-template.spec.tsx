import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { TemplateRenderer } from "./TemplateRenderer.js";
import type { TemplateVersionDefinition } from "./types.js";

/**
 * P2-02 — the reference template, rendered from the seed fixtures themselves.
 *
 * ## What `P0-21` proved, and what it could not
 *
 * `P0-21` seeded a reference template and a demo invitation and proved them **complete
 * against each other**: every `required_field` the template declares is filled by the
 * demo. What was unproven — and what the card says so in as many words — is that they
 * *render*. A definition can be complete and still name a component nobody wrote.
 *
 * ## It reads the JSON, it does not restate it
 *
 * The fixtures are loaded from `backend/api/src/infra/db/seed-data/`, which is the same
 * file the seeder writes to the database. A copy in this directory would pass forever
 * while the seeded template drifted away from it, which is the failure this test exists
 * to make impossible.
 */

const SEED = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "backend",
  "api",
  "src",
  "infra",
  "db",
  "seed-data",
);

const referenceTemplate = JSON.parse(
  readFileSync(join(SEED, "reference-template.json"), "utf8"),
) as {
  sections: TemplateVersionDefinition["sections"];
  theme: Record<string, unknown>;
  customizable_theme_keys: string[];
};

const demo = JSON.parse(
  readFileSync(join(SEED, "demo-invitation.json"), "utf8"),
) as Record<string, unknown>;

/**
 * The seed JSON is shaped for the seeder, which writes rows per table. The renderer takes
 * `docs/PLAN/08`'s canonical shape. This is the same mapping `P2-07`'s public API will
 * perform server-side.
 */
function toCanonical(seed: Record<string, unknown>): Record<string, unknown> {
  const people = (seed["people"] ?? []) as { role: string }[];
  const byRole = (role: string) => people.find((p) => p.role === role) ?? {};

  return {
    couple: { groom: byRole("groom"), bride: byRole("bride") },
    events: (seed["events"] ?? []) as unknown[],
    gallery: { photos: (seed["gallery"] ?? []) as unknown[] },
    gift: { accounts: (seed["bank_accounts"] ?? []) as unknown[] },
    quote: (seed["quote"] ?? {}) as Record<string, unknown>,
  };
}

const version: TemplateVersionDefinition = {
  sections: referenceTemplate.sections,
  theme: referenceTemplate.theme,
  customizable_theme_keys: referenceTemplate.customizable_theme_keys,
};

describe("the reference template renders the demo invitation", () => {
  it("renders every section the template enables, in the template's order", () => {
    const onSectionIssue = vi.fn();

    render(
      <TemplateRenderer
        mode="demo"
        templateVersion={version}
        invitationData={toCanonical(demo)}
        onSectionIssue={onSectionIssue}
      />,
    );

    const rendered = [...document.querySelectorAll("[data-section]")].map(
      (el) => el.getAttribute("data-section"),
    );

    // Exactly the sections the definition turns on, in definition order. Not a count:
    // a count passes when two sections swap places, and order is what the template
    // controls.
    const expected = referenceTemplate.sections
      .filter((s) => !s.configurable || s.enabled_by_default)
      .map((s) => s.section_key);

    expect(rendered).toEqual(expected);
    expect(
      onSectionIssue,
      "every component the reference template names must exist -- docs/PLAN/18 R5",
    ).not.toHaveBeenCalled();
  });

  it("leaves out the one section the template ships disabled", () => {
    render(
      <TemplateRenderer
        mode="demo"
        templateVersion={version}
        invitationData={toCanonical(demo)}
      />,
    );

    // `gift` is `enabled_by_default: false` in the reference template. This asserts the
    // fixture's own intent rather than a hard-coded key, so it stays true if that
    // changes -- and fails loudly if the template stops shipping any section disabled,
    // at which point this test is no longer testing anything.
    const disabled = referenceTemplate.sections.filter(
      (s) => s.configurable && !s.enabled_by_default,
    );
    expect(
      disabled.length,
      "the reference template no longer ships a disabled section; this test is now vacuous",
    ).toBeGreaterThan(0);

    for (const section of disabled) {
      expect(
        document.querySelector(`[data-section="${section.section_key}"]`),
      ).toBeNull();
    }
  });

  it("puts the template's own theme on the root as custom properties", () => {
    render(
      <TemplateRenderer
        mode="demo"
        templateVersion={version}
        invitationData={toCanonical(demo)}
      />,
    );

    const root = document.querySelector<HTMLElement>(
      "[data-template-renderer]",
    );
    const colors = referenceTemplate.theme["colors"] as Record<string, string>;

    expect(root?.style.getPropertyValue("--color-primary")).toBe(
      colors["primary"],
    );
  });

  it("gives the couple section the demo's real names", () => {
    render(
      <TemplateRenderer
        mode="demo"
        templateVersion={version}
        invitationData={toCanonical(demo)}
      />,
    );

    const couple = document.querySelector('[data-section="couple"]');
    expect(couple?.textContent).toContain("Budi");
    expect(couple?.textContent).toContain("Siti");
  });

  it("renders both events, each keeping its own venue", () => {
    render(
      <TemplateRenderer
        mode="demo"
        templateVersion={version}
        invitationData={toCanonical(demo)}
      />,
    );

    const events = document.querySelector('[data-section="event"]');
    // `docs/PLAN/08` has 1..N events, not a fixed akad/reception pair. Both must arrive,
    // and each with its own venue rather than as two parallel lists.
    expect(events?.textContent).toContain("Masjid Agung Bandung");
    expect(events?.textContent).toContain("Akad Nikah");
  });

  it("renders in every mode without a component complaining", () => {
    for (const mode of ["live", "public", "demo"] as const) {
      const onSectionIssue = vi.fn();
      const { unmount } = render(
        <TemplateRenderer
          mode={mode}
          templateVersion={version}
          invitationData={toCanonical(demo)}
          onSectionIssue={onSectionIssue}
        />,
      );

      expect(onSectionIssue, `mode ${mode}`).not.toHaveBeenCalled();
      unmount();
    }
  });
});
