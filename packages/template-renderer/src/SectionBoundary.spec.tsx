import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { TemplateRenderer } from "./TemplateRenderer.js";
import type { SectionComponent, SectionDefinition } from "./types.js";

/**
 * P2-04 — one broken section never takes down an invitation.
 *
 * ## Why the registry is mocked rather than mutated
 *
 * `COMPONENT_REGISTRY` is frozen, and `registry.spec.tsx` asserts that it is, so that no
 * application can register a component the API does not know about. The first version of
 * this file swapped an entry with `Object.defineProperty` and failed with "Cannot
 * redefine property" — the design working exactly as intended.
 *
 * So the throwing component is injected where the renderer **looks a name up**, which
 * leaves the frozen registry untouched and still exercises the real render path.
 *
 * ## React logs caught errors to the console, loudly
 *
 * That is correct behaviour and it makes a passing test look like a failing one. The
 * console error is silenced per test rather than globally, so a genuine unexpected error
 * elsewhere in the suite still shows.
 */

/** A component that always throws. */
const Exploding: SectionComponent = () => {
  throw new Error("gallery data is corrupt");
};

/**
 * Which registered name resolves to `Exploding` for the current test.
 *
 * A module-level value because `vi.mock` is hoisted above every declaration in the file;
 * its factory closes over whatever this holds at call time.
 */
let exploding = "";
const explode = (name: string): void => {
  exploding = name;
};

vi.mock("./registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./registry.js")>();

  return {
    ...actual,
    resolveComponent: (name: string) =>
      name === exploding ? Exploding : actual.resolveComponent(name),
  };
});

const section = (over: Partial<SectionDefinition> = {}): SectionDefinition => ({
  section_key: "hero",
  component: "HeroClassic",
  enabled_by_default: true,
  configurable: true,
  required_fields: [],
  optional_fields: [],
  ...over,
});

const version = (sections: SectionDefinition[]) => ({
  sections,
  theme: { colors: { primary: "#b76e79" } },
  customizable_theme_keys: [],
});

const DATA = {
  couple: { groom: { nickname: "Budi" }, bride: { nickname: "Siti" } },
  events: [
    {
      title: "Akad Nikah",
      date: "2027-05-15",
      start_time: "08:00",
      venue_name: "Masjid Agung Bandung",
    },
  ],
  gift: { accounts: [{ account_number: "1234567890", provider_name: "BCA" }] },
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  explode("");
  consoleError.mockRestore();
});

describe("a section that throws", () => {
  it("does not blank the page — every other section still renders", () => {
    explode("GalleryGrid");

    render(
      <TemplateRenderer
        mode="public"
        invitationData={DATA}
        templateVersion={version([
          section({ section_key: "hero", component: "HeroClassic" }),
          section({ section_key: "gallery", component: "GalleryGrid" }),
          section({
            section_key: "event",
            component: "EventCardDouble",
            required_fields: [
              "events.*.title",
              "events.*.date",
              "events.*.start_time",
              "events.*.venue_name",
            ],
          }),
          section({ section_key: "rsvp", component: "RsvpForm" }),
        ])}
      />,
    );

    // `docs/FRONTEND/08`: "RSVP/event info is the most important function and must never
    // disappear because another section broke." A guest who cannot find the venue or
    // confirm attendance is the outcome this boundary exists to prevent.
    expect(screen.getByText("Masjid Agung Bandung")).toBeInTheDocument();
    expect(screen.getByLabelText(/nama/i)).toBeInTheDocument();
    expect(document.querySelectorAll("[data-section]")).toHaveLength(4);
  });

  it("renders nothing for the failed section rather than an error box", () => {
    explode("GalleryGrid");

    render(
      <TemplateRenderer
        mode="public"
        invitationData={DATA}
        templateVersion={version([
          section({ section_key: "gallery", component: "GalleryGrid" }),
        ])}
      />,
    );

    // A guest who never knew the gallery existed is not served by being told it is
    // broken, and an error box in a wedding invitation is worse for the couple than a
    // missing section.
    const rendered = document.querySelector('[data-section="gallery"]');
    expect(rendered).not.toBeNull();
    expect(rendered?.textContent).toBe("");
    expect(document.body.textContent).not.toContain("corrupt");
  });

  it("shows a caller-supplied fallback where one is given", () => {
    // The editor passes one, because there the couple IS the person who needs to know
    // that a section failed to draw.
    explode("GalleryGrid");

    render(
      <TemplateRenderer
        mode="live"
        invitationData={DATA}
        sectionFallback={<p>Bagian ini gagal ditampilkan.</p>}
        templateVersion={version([
          section({ section_key: "gallery", component: "GalleryGrid" }),
        ])}
      />,
    );

    expect(screen.getByText(/gagal ditampilkan/i)).toBeInTheDocument();
  });

  it("isolates each section separately, so two failures do not compound", () => {
    explode("GalleryGrid");

    render(
      <TemplateRenderer
        mode="public"
        invitationData={DATA}
        templateVersion={version([
          section({ section_key: "gallery", component: "GalleryGrid" }),
          section({ section_key: "gallery", component: "GalleryGrid" }),
          section({
            section_key: "event",
            component: "EventCardDouble",
            required_fields: ["events.*.title", "events.*.venue_name"],
          }),
        ])}
      />,
    );

    // One boundary around the whole list would lose the event to the first gallery's
    // failure. Per-section is what `docs/FRONTEND/04` asks for and this is the assertion
    // that tells the two designs apart.
    expect(screen.getByText("Masjid Agung Bandung")).toBeInTheDocument();
  });
});

describe("data corrupt enough to break a real component", () => {
  it("keeps the rest of the page rendering", () => {
    // The components are defensive by construction (`P2-03`'s `rows` and `text` helpers),
    // so bad data usually renders an empty section rather than throwing. That is the
    // better outcome and it means this test asserts the *combination*: malformed data in
    // one section, everything else intact.
    render(
      <TemplateRenderer
        mode="public"
        invitationData={{ ...DATA, gallery: { photos: { not: "an array" } } }}
        templateVersion={version([
          section({
            section_key: "gallery",
            component: "GalleryGrid",
            required_fields: ["gallery.photos"],
          }),
          section({
            section_key: "event",
            component: "EventCardDouble",
            required_fields: ["events.*.title", "events.*.venue_name"],
          }),
          section({ section_key: "rsvp", component: "RsvpForm" }),
        ])}
      />,
    );

    expect(screen.getByText("Masjid Agung Bandung")).toBeInTheDocument();
    expect(screen.getByLabelText(/nama/i)).toBeInTheDocument();
  });
});

describe("the error report", () => {
  it("names the section and the component", () => {
    explode("GalleryGrid");
    const onSectionError = vi.fn();

    render(
      <TemplateRenderer
        mode="public"
        invitationData={DATA}
        onSectionError={onSectionError}
        templateVersion={version([
          section({ section_key: "gallery", component: "GalleryGrid" }),
        ])}
      />,
    );

    expect(onSectionError).toHaveBeenCalledTimes(1);
    expect(onSectionError.mock.calls[0]?.[0]).toMatchObject({
      sectionKey: "gallery",
      component: "GalleryGrid",
      message: "gallery data is corrupt",
    });
  });

  it("carries no section data, however sensitive the section was", () => {
    // `docs/FRONTEND/08` § Logging: context, "WITHOUT including sensitive data (bank
    // account numbers, etc.)". The obvious thing to attach to a render error is the props
    // that caused it — and for this renderer those props are sometimes exactly that.
    explode("GiftAccountList");
    const onSectionError = vi.fn();

    render(
      <TemplateRenderer
        mode="public"
        invitationData={{
          gift: {
            accounts: [{ account_number: "9998887776", provider_name: "BCA" }],
          },
        }}
        onSectionError={onSectionError}
        templateVersion={version([
          section({
            section_key: "gift",
            component: "GiftAccountList",
            required_fields: ["gift.accounts.*.account_number"],
          }),
        ])}
      />,
    );

    const report = JSON.stringify(onSectionError.mock.calls[0]?.[0]);
    expect(report).not.toContain("9998887776");
    expect(report).not.toContain("accounts");
  });

  it("does not require a handler", () => {
    // The catalogue demo has nowhere to send a report and must not crash for the lack of
    // one — a boundary that caused the outage it exists to prevent.
    explode("GalleryGrid");

    expect(() =>
      render(
        <TemplateRenderer
          mode="demo"
          invitationData={DATA}
          templateVersion={version([
            section({ section_key: "gallery", component: "GalleryGrid" }),
          ])}
        />,
      ),
    ).not.toThrow();
  });
});
