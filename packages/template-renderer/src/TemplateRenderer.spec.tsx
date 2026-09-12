import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { TemplateRenderer } from "./TemplateRenderer.js";
import type { SectionDefinition, TemplateVersionDefinition } from "./types.js";

/**
 * P2-02 — the render flow. `docs/FRONTEND/04` § Render Flow, step by step.
 */

const section = (over: Partial<SectionDefinition> = {}): SectionDefinition => ({
  section_key: "hero",
  component: "HeroClassic",
  enabled_by_default: true,
  configurable: true,
  required_fields: [],
  optional_fields: [],
  ...over,
});

const version = (
  sections: SectionDefinition[],
  over: Partial<TemplateVersionDefinition> = {},
): TemplateVersionDefinition => ({
  sections,
  theme: { colors: { primary: "#b76e79" } },
  customizable_theme_keys: ["colors.primary"],
  ...over,
});

const DATA = {
  couple: {
    groom: { nickname: "Budi", full_name: "Budi Santoso" },
    bride: { nickname: "Siti", full_name: "Siti Nurhaliza" },
  },
  events: [
    { title: "Akad Nikah", venue_name: "Masjid Agung", type: "akad" },
    { title: "Resepsi", venue_name: "Gedung Merdeka", type: "reception" },
  ],
  gift: { accounts: [{ account_number: "1234567890" }] },
  quote: { text: "Sebuah kutipan" },
};

describe("step 1 — sections render in the template's order", () => {
  it("renders them in the order the definition lists, not alphabetically", () => {
    render(
      <TemplateRenderer
        mode="public"
        invitationData={DATA}
        templateVersion={version([
          section({ section_key: "closing", component: "ClosingSimple" }),
          section({ section_key: "hero", component: "HeroClassic" }),
          section({ section_key: "gallery", component: "GalleryGrid" }),
        ])}
      />,
    );

    const rendered = [...document.querySelectorAll("[data-section]")].map(
      (el) => el.getAttribute("data-section"),
    );
    expect(rendered).toEqual(["closing", "hero", "gallery"]);
  });

  it("renders two sections of the same key without a duplicate-key collapse", () => {
    // `docs/PLAN/07` does not forbid a template having two galleries. A React key of just
    // the section key would render one and warn.
    render(
      <TemplateRenderer
        mode="public"
        invitationData={DATA}
        templateVersion={version([
          section({ section_key: "gallery", component: "GalleryGrid" }),
          section({ section_key: "gallery", component: "GalleryCarousel" }),
        ])}
      />,
    );

    expect(document.querySelectorAll('[data-section="gallery"]')).toHaveLength(
      2,
    );
  });
});

describe("step 2 — enabled_sections decides, with one exception", () => {
  it("omits a section the settings do not enable", () => {
    render(
      <TemplateRenderer
        mode="public"
        invitationData={DATA}
        enabledSections={["hero"]}
        templateVersion={version([
          section({ section_key: "hero", component: "HeroClassic" }),
          section({ section_key: "gallery", component: "GalleryGrid" }),
        ])}
      />,
    );

    expect(document.querySelector('[data-section="hero"]')).not.toBeNull();
    expect(document.querySelector('[data-section="gallery"]')).toBeNull();
  });

  it("a disabled section is absent from the DOM, not hidden", () => {
    // The card's own wording: "a hidden section is still a data leak in the page source".
    // A `display:none` gallery still ships every caption to every guest.
    render(
      <TemplateRenderer
        mode="public"
        invitationData={{
          ...DATA,
          gift: { accounts: [{ account_number: "SECRET-ACCOUNT-9999" }] },
        }}
        enabledSections={["hero"]}
        templateVersion={version([
          section({ section_key: "hero", component: "HeroClassic" }),
          section({
            section_key: "gift",
            component: "GiftAccountList",
            required_fields: ["gift.accounts.*.account_number"],
          }),
        ])}
      />,
    );

    expect(document.body.innerHTML).not.toContain("SECRET-ACCOUNT-9999");
  });

  it("shows a non-configurable section even when the settings omit it", () => {
    // `docs/FRONTEND/04` step 2's explicit exception, and what `P1-15`'s recompute relies
    // on: a section the user cannot turn off is not the user's to turn off.
    render(
      <TemplateRenderer
        mode="public"
        invitationData={DATA}
        enabledSections={[]}
        templateVersion={version([
          section({
            section_key: "hero",
            component: "HeroClassic",
            configurable: false,
          }),
        ])}
      />,
    );

    expect(document.querySelector('[data-section="hero"]')).not.toBeNull();
  });

  it("falls back to enabled_by_default when no settings are supplied", () => {
    // The demo and catalogue case: no invitation settings exist, so the template's own
    // opinion is what a demo should show.
    render(
      <TemplateRenderer
        mode="demo"
        invitationData={DATA}
        templateVersion={version([
          section({ section_key: "hero", enabled_by_default: true }),
          section({
            section_key: "guestbook",
            component: "GuestbookWall",
            enabled_by_default: false,
          }),
        ])}
      />,
    );

    expect(document.querySelector('[data-section="hero"]')).not.toBeNull();
    expect(document.querySelector('[data-section="guestbook"]')).toBeNull();
  });
});

describe("step 3 — the component name resolves through the registry", () => {
  it("records which component rendered a section", () => {
    render(
      <TemplateRenderer
        mode="public"
        invitationData={DATA}
        templateVersion={version([
          section({ section_key: "gallery", component: "GalleryCarousel" }),
        ])}
      />,
    );

    expect(
      document
        .querySelector('[data-section="gallery"]')
        ?.getAttribute("data-component"),
    ).toBe("GalleryCarousel");
  });

  it("skips a section whose component is not registered, and renders the rest", () => {
    // `docs/PLAN/18` R5. A blank invitation because one stored definition names a removed
    // component is the outcome this avoids.
    const onSectionIssue = vi.fn();

    render(
      <TemplateRenderer
        mode="public"
        invitationData={DATA}
        onSectionIssue={onSectionIssue}
        templateVersion={version([
          section({ section_key: "hero", component: "HeroClassic" }),
          section({ section_key: "gallery", component: "GalleryGridV99" }),
          section({ section_key: "closing", component: "ClosingSimple" }),
        ])}
      />,
    );

    expect(document.querySelectorAll("[data-section]")).toHaveLength(2);
    expect(onSectionIssue).toHaveBeenCalledWith({
      sectionKey: "gallery",
      component: "GalleryGridV99",
      reason: "unregistered_component",
    });
  });

  it("does not require the caller to supply a handler for that", () => {
    // `public-invite` logs it server-side and the editor shows it; the demo does neither,
    // and must not crash for the lack of a callback.
    expect(() =>
      render(
        <TemplateRenderer
          mode="demo"
          invitationData={DATA}
          templateVersion={version([
            section({ component: "NotARealComponent" }),
          ])}
        />,
      ),
    ).not.toThrow();
  });
});

describe("step 4 — the data subset", () => {
  it("gives a section only the fields it declared", () => {
    // The resolver's own properties are asserted in `resolve-data.spec.ts`, where they
    // cannot be made vacuous by a component change. What belongs HERE is that the
    // renderer actually applies it: a section rendered with the whole invitation would
    // pass every resolver test and still leak.
    render(
      <TemplateRenderer
        mode="public"
        invitationData={{
          couple: { groom: { nickname: "Budi" }, bride: { nickname: "Siti" } },
          gift: { accounts: [{ account_number: "SECRET-9999" }] },
        }}
        templateVersion={version([
          section({
            section_key: "couple",
            component: "CoupleProfile",
            required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
          }),
        ])}
      />,
    );

    expect(document.body.textContent).toContain("Budi");
    expect(document.body.innerHTML).not.toContain("SECRET-9999");
  });
});

describe("step 5 — the props a component receives", () => {
  it("applies the theme as custom properties at the root", () => {
    render(
      <TemplateRenderer
        mode="public"
        invitationData={DATA}
        templateVersion={version([section()], {
          theme: {
            colors: { primary: "#b76e79", text: "#2b2b2b" },
            typography: { heading_font: "Playfair Display" },
          },
        })}
      />,
    );

    const root = document.querySelector<HTMLElement>(
      "[data-template-renderer]",
    );
    expect(root?.style.getPropertyValue("--color-primary")).toBe("#b76e79");
    expect(root?.style.getPropertyValue("--typography-heading-font")).toBe(
      "Playfair Display",
    );
  });

  it("turns the word-valued theme tokens into usable CSS", () => {
    // `spacing` and `border_radius` are words in the schema -- a template author picks a
    // feel, not a pixel count. Something has to translate, and a component that knew
    // "comfortable" meant 1.25rem would have to be edited to change the scale.
    render(
      <TemplateRenderer
        mode="public"
        invitationData={DATA}
        templateVersion={version([section()], {
          theme: {
            colors: { primary: "#b76e79" },
            spacing: "spacious",
            border_radius: "none",
          },
        })}
      />,
    );

    const root = document.querySelector<HTMLElement>(
      "[data-template-renderer]",
    );
    expect(root?.style.getPropertyValue("--space")).toBe("2rem");
    expect(root?.style.getPropertyValue("--radius")).toBe("0");
  });

  it("passes layout_variant down, so a definition can override the component's default", () => {
    render(
      <TemplateRenderer
        mode="public"
        invitationData={{
          gallery: {
            photos: [{ url: "https://cdn.test/a.jpg", media_id: "a" }],
          },
        }}
        templateVersion={version([
          section({
            section_key: "gallery",
            // Named Grid, asked for a carousel. The definition wins.
            component: "GalleryGrid",
            layout_variant: "carousel",
            required_fields: ["gallery.photos"],
          }),
        ])}
      />,
    );

    expect(
      document.querySelector("[data-variant]")?.getAttribute("data-variant"),
    ).toBe("carousel");
  });

  it("passes max_items down, so a template's cap is honoured", () => {
    render(
      <TemplateRenderer
        mode="public"
        invitationData={{
          gallery: {
            photos: Array.from({ length: 10 }, (_, i) => ({
              url: `https://cdn.test/${String(i)}.jpg`,
              media_id: String(i),
            })),
          },
        }}
        templateVersion={version([
          section({
            section_key: "gallery",
            component: "GalleryGrid",
            max_items: 3,
            required_fields: ["gallery.photos"],
          }),
        ])}
      />,
    );

    // A couple with 200 photos must not break a layout designed for 20.
    expect(document.querySelectorAll(".wi-photo")).toHaveLength(3);
  });

  it.each(["live", "public", "demo"] as const)(
    "passes mode=%s to every section",
    (mode) => {
      render(
        <TemplateRenderer
          mode={mode}
          invitationData={{
            gift: {
              accounts: [
                { account_number: "1234567890", provider_name: "BCA" },
              ],
            },
          }}
          templateVersion={version([
            section({
              section_key: "gift",
              component: "GiftAccountList",
              required_fields: [
                "gift.accounts.*.account_number",
                "gift.accounts.*.provider_name",
              ],
            }),
          ])}
        />,
      );

      // The copy button is the mode made visible: `docs/FRONTEND/04` § Mode Differences
      // makes interaction live only in `public`, and a button that appears to work and
      // does not is worse than one plainly disabled.
      const copy =
        document.querySelector<HTMLButtonElement>(".wi-button-quiet");
      expect(copy?.disabled).toBe(mode !== "public");
      expect(
        document
          .querySelector("[data-template-renderer]")
          ?.getAttribute("data-mode"),
      ).toBe(mode);
    },
  );
});

describe("what the renderer must never do", () => {
  it("renders markup in a name as text, never as HTML", () => {
    // `P1-16` sanitizes on the way in. This is the layer that makes a miss there visible
    // rather than exploitable: React escapes, so the tag is characters on the page.
    render(
      <TemplateRenderer
        mode="public"
        invitationData={{
          couple: { groom: { nickname: "<img src=x onerror=alert(1)>" } },
        }}
        templateVersion={version([
          section({ required_fields: ["couple.groom.nickname"] }),
        ])}
      />,
    );

    expect(document.querySelector("img")).toBeNull();
    expect(document.body.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("ignores a theme override the template does not list as customizable", () => {
    render(
      <TemplateRenderer
        mode="public"
        invitationData={DATA}
        themeOverride={{
          "colors.primary": "#000000",
          "typography.heading_font": "Comic Sans MS",
        }}
        templateVersion={version([section()], {
          theme: {
            colors: { primary: "#b76e79" },
            typography: { heading_font: "Playfair Display" },
          },
          customizable_theme_keys: ["colors.primary"],
        })}
      />,
    );

    const root = document.querySelector<HTMLElement>(
      "[data-template-renderer]",
    );
    expect(root?.style.getPropertyValue("--color-primary")).toBe("#000000");
    // Not listed as customizable, so the stored override does not take effect -- the case
    // that arises after a template change narrows the list (ADR-054).
    expect(root?.style.getPropertyValue("--typography-heading-font")).toBe(
      "Playfair Display",
    );
  });

  it("does not mutate the template's own theme when applying an override", () => {
    const templateVersion = version([section()], {
      theme: { colors: { primary: "#b76e79" } },
      customizable_theme_keys: ["colors.primary"],
    });

    render(
      <TemplateRenderer
        mode="public"
        invitationData={DATA}
        themeOverride={{ "colors.primary": "#000000" }}
        templateVersion={templateVersion}
      />,
    );

    // The definition came from a cache in `P2-01` and may be shared between requests.
    // Mutating it would apply one invitation's colour to the next one rendered.
    expect(templateVersion.theme).toEqual({ colors: { primary: "#b76e79" } });
  });

  it("renders nothing at all for a template with no sections", () => {
    render(
      <TemplateRenderer
        mode="public"
        invitationData={DATA}
        templateVersion={version([])}
      />,
    );

    // The root still exists, carrying the theme -- an empty template is a template with
    // no sections, not an absent renderer. `P2-11`'s catalogue can render a template whose
    // sections are all disabled and must get a themed empty page rather than nothing.
    expect(document.querySelectorAll("[data-section]")).toHaveLength(0);
    expect(document.querySelector("[data-template-renderer]")).not.toBeNull();
  });
});
