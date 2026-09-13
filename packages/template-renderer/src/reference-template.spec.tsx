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
    // `gift_accounts`, the demo file's key. This read `bank_accounts` until `P2-14`'s
    // combination test asked for a gift account to look for and found none: every render in
    // this file had run with an empty gift section.
    gift: { accounts: (seed["gift_accounts"] ?? []) as unknown[] },
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

/**
 * `P2-13` — the reference template's photographs, fed the shape the PUBLIC API serves.
 *
 * Every test above feeds `toCanonical(demo)`, whose gallery rows come from the seed and carry
 * no URLs at all — so none of them could notice that the hero never received its cover photo.
 * It did not: the hero declared `gallery.photos.*.media_id`, the resolver narrowed each photo
 * to that one field, and the public payload deliberately carries no `media_id` (`P2-07`). The
 * reference template's cover image had never rendered on a public page.
 *
 * These tests use a payload shaped exactly like `GET /public/i/:slug`'s gallery.
 */
describe("the reference template's photos, as the public API serves them", () => {
  const photos = {
    photos: [
      {
        url: "https://cdn.test/a-large.webp",
        medium_url: "https://cdn.test/a-medium.webp",
        thumbnail_url: "https://cdn.test/a-thumb.webp",
        caption: "Lembang",
        is_cover: false,
        order: 0,
      },
      {
        url: "https://cdn.test/cover-large.webp",
        medium_url: "https://cdn.test/cover-medium.webp",
        thumbnail_url: "https://cdn.test/cover-thumb.webp",
        caption: "Sampul",
        is_cover: true,
        order: 1,
      },
    ],
  };

  const renderPublic = () =>
    render(
      <TemplateRenderer
        mode="public"
        templateVersion={version}
        invitationData={{ ...toCanonical(demo), gallery: photos }}
        enabledSections={["hero", "gallery"]}
      />,
    );

  it("gives the hero its cover photo", () => {
    renderPublic();

    const cover = document.querySelector<HTMLImageElement>(
      '[data-section="hero"] img',
    );
    expect(cover, "the hero rendered no image").not.toBeNull();
    expect(cover?.getAttribute("src")).toBe(
      "https://cdn.test/cover-medium.webp",
    );
  });

  it("loads the cover eagerly at high priority, because it is the LCP element", () => {
    renderPublic();

    const cover = document.querySelector('[data-section="hero"] img');
    expect(cover?.getAttribute("loading")).toBe("eager");
    expect(cover?.getAttribute("fetchpriority")).toBe("high");
    // What the browser suite measures the cover's paint by.
    expect(cover?.getAttribute("elementtiming")).toBe("wi-lcp-image");
  });

  it("lazy-loads every other photo", () => {
    renderPublic();

    const gallery = [
      ...document.querySelectorAll('[data-section="gallery"] img'),
    ];
    expect(gallery.length).toBeGreaterThan(0);
    for (const image of gallery) {
      expect(image.getAttribute("loading")).toBe("lazy");
      expect(image.getAttribute("fetchpriority")).toBeNull();
    }
  });

  it("serves the hero the 800w variant, never the 1600w file (ADR-067)", () => {
    renderPublic();

    const cover = document.querySelector('[data-section="hero"] img');
    expect(cover?.getAttribute("src")).toBe(
      "https://cdn.test/cover-medium.webp",
    );
    // No srcset: a dense phone would pick the large file from one, which is what cost 1.4s.
    expect(cover?.getAttribute("srcset")).toBeNull();
  });

  it("falls back to the large file for a photo with no medium variant", () => {
    render(
      <TemplateRenderer
        mode="public"
        templateVersion={version}
        invitationData={{
          ...toCanonical(demo),
          gallery: {
            photos: [{ url: "https://cdn.test/only.webp", is_cover: true }],
          },
        }}
        enabledSections={["hero"]}
      />,
    );

    expect(
      document.querySelector('[data-section="hero"] img')?.getAttribute("src"),
    ).toBe("https://cdn.test/only.webp");
  });

  it("offers the gallery's photos the pre-generated variants as a srcset", () => {
    renderPublic();

    const photo = document.querySelector('[data-section="gallery"] img');
    expect(photo?.getAttribute("srcset")).toBe(
      "https://cdn.test/a-thumb.webp 300w, https://cdn.test/a-medium.webp 800w, https://cdn.test/a-large.webp 1600w",
    );
    expect(photo?.getAttribute("sizes")).toContain("rem");
  });
});

/**
 * `P2-14` step 1 — `docs/FRONTEND/10` § Integration Test: "render with dummy data across
 * various `enabled_sections` combinations → verify inactive sections don't appear in the
 * DOM".
 *
 * Not "various": **every** combination of the reference template's configurable sections,
 * rendered with the demo invitation. The sections rendered must be exactly the
 * non-configurable ones plus the chosen subset, in template order — and a disabled section's
 * data must not be anywhere in the markup, not merely hidden.
 */
describe("every enabled_sections combination of the reference template", () => {
  const sections = referenceTemplate.sections;
  const configurable = sections
    .filter((s) => s.configurable)
    .map((s) => s.section_key);
  const structural = sections
    .filter((s) => !s.configurable)
    .map((s) => s.section_key);

  const canonical = toCanonical(demo);
  /** A string only that section's data carries, to prove absence from the markup. */
  const markers: Record<string, string | undefined> = {
    gift: (canonical["gift"] as { accounts: { account_number?: string }[] })
      .accounts[0]?.account_number,
    quote: (canonical["quote"] as { text?: string }).text,
  };

  it("has something to combine", () => {
    // Negative control: a template with no configurable sections would make the loop below
    // assert nothing 1 time.
    expect(configurable.length).toBeGreaterThanOrEqual(5);
    expect(
      markers["gift"],
      "the demo has no gift account to look for",
    ).toBeTruthy();
    expect(markers["quote"], "the demo has no quote to look for").toBeTruthy();
  });

  it(`renders exactly the chosen sections for all ${String(2 ** configurable.length)} subsets`, () => {
    const failures: string[] = [];

    for (let mask = 0; mask < 2 ** configurable.length; mask += 1) {
      const chosen = configurable.filter((_, index) => (mask >> index) & 1);
      const { container, unmount } = render(
        <TemplateRenderer
          mode="public"
          templateVersion={version}
          invitationData={canonical}
          enabledSections={chosen}
        />,
      );

      const rendered = [...container.querySelectorAll("[data-section]")].map(
        (el) => el.getAttribute("data-section"),
      );
      const expected = sections
        .map((s) => s.section_key)
        .filter((key) => structural.includes(key) || chosen.includes(key));

      if (JSON.stringify(rendered) !== JSON.stringify(expected)) {
        failures.push(`[${chosen.join(",")}] rendered [${rendered.join(",")}]`);
      }
      const html = container.innerHTML;
      for (const [key, marker] of Object.entries(markers)) {
        if (
          !chosen.includes(key) &&
          marker !== undefined &&
          html.includes(marker)
        ) {
          failures.push(
            `[${chosen.join(",")}] leaked ${key} data into the markup`,
          );
        }
      }
      unmount();
    }

    expect(failures).toEqual([]);
    // 256 full renders: ~3.5s alone, 15s under `pnpm verify`'s parallel load, where the 5s
    // default failed it once. The bound is generous on purpose; a hang still fails.
  }, 60_000);
});
