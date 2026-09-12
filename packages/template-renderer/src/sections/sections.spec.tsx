import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";

import { COMPONENT_REGISTRY } from "../registry.js";
import { SECTION_STYLES } from "./styles.js";
import { nearestUpcoming, remainingUntil } from "./EventCardDouble.js";
import type { RenderMode, SectionProps } from "../types.js";

/**
 * P2-03 — the ten sections.
 *
 * ## The accessibility check, and what it cannot see
 *
 * axe runs in jsdom, which has no layout engine, so **`color-contrast` cannot run** — the
 * same gap `@wi/ui`'s helper documents. It is named here rather than left to imply
 * coverage: the contrast that matters most on this surface is text over a **photograph**,
 * and the thing that guarantees it is the hero's scrim, which is asserted structurally
 * below and measured for real in `P2-13`'s browser pass.
 */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function violations(container: Element): Promise<string[]> {
  const results = await axe.run(container, {
    runOnly: { type: "tag", values: WCAG },
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.help}`);
}

const props = (
  data: Record<string, unknown>,
  over: Partial<SectionProps> = {},
): SectionProps => ({
  data,
  theme: { colors: { primary: "#b76e79" } },
  layoutVariant: undefined,
  mode: "public" as RenderMode,
  maxItems: undefined,
  ...over,
});

const FULL = {
  couple: {
    groom: {
      nickname: "Budi",
      full_name: "Budi Santoso",
      father_name: "Bapak Santoso",
      mother_name: "Ibu Rahayu",
      child_order: "Putra pertama",
      instagram: "budisantoso",
      photo: "https://cdn.test/groom.jpg",
    },
    bride: {
      nickname: "Siti",
      full_name: "Siti Nurhaliza",
      father_name: "Bapak Nurhalim",
      mother_name: "Ibu Dewi",
    },
  },
  events: [
    {
      title: "Akad Nikah",
      date: "2027-05-15",
      start_time: "08:00",
      end_time: "10:00",
      venue_name: "Masjid Agung Bandung",
      address: "Jl. Asia Afrika No. 1",
      latitude: "-6.921690",
      longitude: "107.606690",
      description: "Mohon hadir 15 menit sebelumnya.",
    },
  ],
  gallery: {
    photos: [
      { media_id: "a", url: "https://cdn.test/a.jpg", caption: "Prewedding" },
      { media_id: "b", url: "https://cdn.test/b.jpg", is_cover: true },
    ],
  },
  gift: {
    accounts: [
      {
        provider_name: "BCA",
        account_number: "1234567890",
        account_holder: "Budi Santoso",
      },
    ],
  },
  quote: {
    text: "Dan di antara tanda-tanda kekuasaan-Nya",
    source: "Ar-Rum 21",
  },
  guestbook: { entries: [{ guest_name: "Andi", message: "Selamat!" }] },
};

/** Every registered component, with the full data. The DoD is "each component". */
const EVERY = Object.entries(COMPONENT_REGISTRY);

describe("every section passes the automated accessibility check", () => {
  it.each(EVERY)("%s", async (_name, Component) => {
    const { container } = render(<Component {...props(FULL)} />);
    expect(await violations(container)).toEqual([]);
  });
});

describe("every section survives having no data at all", () => {
  // A draft being edited is mostly empty, and the live preview renders it on every
  // keystroke. A section that threw on an absent field would make the editor unusable --
  // `P2-06`'s publish check is where incompleteness is refused, not here.
  it.each(EVERY)(
    "%s renders or returns null, never throws",
    (_name, Component) => {
      expect(() => render(<Component {...props({})} />)).not.toThrow();
    },
  );
});

describe("empty optional fields leave no visual artifact", () => {
  it("omits the parents line entirely when neither parent is named", () => {
    const Component = COMPONENT_REGISTRY["CoupleProfile"]!;
    render(
      <Component
        {...props({ couple: { groom: { full_name: "Budi Santoso" } } })}
      />,
    );

    // Not "Putra/Putri dari " with a trailing preposition, and not an empty paragraph
    // holding margin -- `docs/PLAN/07` § Required vs Optional.
    expect(document.body.textContent).not.toContain("Putra/Putri dari");
  });

  it("renders one parent without a dangling conjunction", () => {
    const Component = COMPONENT_REGISTRY["CoupleProfile"]!;
    render(
      <Component
        {...props({
          couple: {
            groom: { full_name: "Budi", father_name: "Bapak Santoso" },
          },
        })}
      />,
    );

    expect(document.body.textContent).toContain("dari Bapak Santoso");
    expect(document.body.textContent).not.toContain("&");
  });

  it("renders no quote section at all when there is no quote", () => {
    const Component = COMPONENT_REGISTRY["QuoteBanner"]!;
    const { container } = render(<Component {...props({})} />);

    // A bordered empty box in the middle of an invitation reads as a bug.
    expect(container.innerHTML).toBe("");
  });

  it("renders no gallery when every photo lacks a url", () => {
    const Component = COMPONENT_REGISTRY["GalleryGrid"]!;
    const { container } = render(
      <Component {...props({ gallery: { photos: [{ media_id: "a" }] } })} />,
    );

    // A media row exists before the worker has produced variants (`P1-18`), so this is
    // the normal state of a photo uploaded seconds ago -- not a corrupt row.
    expect(container.innerHTML).toBe("");
  });

  it("gives an uncaptioned photo empty alt text rather than an invented description", () => {
    const Component = COMPONENT_REGISTRY["GalleryGrid"]!;
    render(
      <Component
        {...props({
          gallery: {
            photos: [
              { media_id: "a", url: "https://cdn.test/a.jpg" },
              {
                media_id: "b",
                url: "https://cdn.test/b.jpg",
                caption: "Prewedding",
              },
            ],
          },
        })}
      />,
    );

    const images = [...document.querySelectorAll("img")];
    expect(images.map((img) => img.getAttribute("alt"))).toEqual([
      "",
      "Prewedding",
    ]);
  });
});

describe("the hero", () => {
  it("puts a scrim behind the text when there is a cover photo", () => {
    // `docs/UI-UX/14` § Accessibility: contrast "even over a photo background (a gradient
    // overlay if needed)". A cover photo is chosen by the couple and can be any
    // brightness, so darkening the image is the only way to guarantee the ratio.
    const Component = COMPONENT_REGISTRY["HeroClassic"]!;
    render(<Component {...props(FULL)} />);

    const scrim = document.querySelector(".wi-hero-scrim");
    expect(scrim).not.toBeNull();
    expect(scrim?.getAttribute("aria-hidden")).toBe("true");
  });

  it("uses the photo marked as cover, not simply the first", () => {
    const Component = COMPONENT_REGISTRY["HeroClassic"]!;
    render(<Component {...props(FULL)} />);

    expect(document.querySelector(".wi-hero-bg")?.getAttribute("src")).toBe(
      "https://cdn.test/b.jpg",
    );
  });

  it("shows a real button for the cover gate", () => {
    // A guest using a keyboard reaches the whole invitation through this one control.
    const Component = COMPONENT_REGISTRY["HeroClassic"]!;
    render(<Component {...props(FULL)} />);

    expect(
      screen.getByRole("button", { name: /buka undangan/i }),
    ).toBeInTheDocument();
  });

  it("does not gate the editor preview", () => {
    // In `live` the couple would otherwise see a button instead of their invitation on
    // every re-render, which is the opposite of a preview.
    const Component = COMPONENT_REGISTRY["HeroClassic"]!;
    render(<Component {...props(FULL, { mode: "live" })} />);

    expect(screen.queryByRole("button", { name: /buka undangan/i })).toBeNull();
  });
});

describe("the maps section carries no map SDK", () => {
  it("renders a Google Maps deep link built from the coordinates", () => {
    // ADR-014 and the card's step 3b. An embedded map is one of the heaviest things a
    // page can load and it bills per load on the one surface with unbounded traffic.
    const Component = COMPONENT_REGISTRY["MapsStatic"]!;
    render(<Component {...props(FULL)} />);

    const link = screen.getByRole("link", { name: /google maps/i });
    expect(link.getAttribute("href")).toContain(
      "google.com/maps/search/?api=1&query=",
    );
    expect(link.getAttribute("href")).toContain("-6.921690");
  });

  it("prefers an explicit maps_url when one is stored", () => {
    const Component = COMPONENT_REGISTRY["MapsStatic"]!;
    render(
      <Component
        {...props({
          events: [
            {
              venue_name: "Gedung Merdeka",
              maps_url: "https://maps.app.goo.gl/abc123",
            },
          ],
        })}
      />,
    );

    expect(
      screen.getByRole("link", { name: /google maps/i }).getAttribute("href"),
    ).toBe("https://maps.app.goo.gl/abc123");
  });

  it("refuses a stored maps_url that is not http(s)", () => {
    // `P1-12` validates this on the way in. Repeating it here is what stops a stored
    // `javascript:` URL becoming an anchor on a page hundreds of guests open.
    const Component = COMPONENT_REGISTRY["MapsStatic"]!;
    render(
      <Component
        {...props({
          events: [{ venue_name: "Gedung", maps_url: "javascript:alert(1)" }],
        })}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(document.body.innerHTML).not.toContain("javascript:");
  });
});

describe("the countdown", () => {
  it("counts toward the nearest event that has not started", () => {
    const now = Date.parse("2027-05-15T09:00:00+07:00");
    const at = nearestUpcoming(
      [
        { date: "2027-05-15", start_time: "08:00" },
        { date: "2027-05-15", start_time: "11:00" },
      ],
      now,
    );

    // A guest opening the invitation between the akad and the reception should see a
    // countdown to the reception, not a negative number counting up from the akad.
    expect(at).toBe(Date.parse("2027-05-15T11:00:00+07:00"));
  });

  it("reads a stored time as WIB, not as the reader's timezone", () => {
    // `event_date` and `start_time` are stored without a zone (`docs/DATABASE/05`) and the
    // product is Indonesian. A guest abroad must not see a countdown seven hours out.
    const at = nearestUpcoming(
      [{ date: "2027-05-15", start_time: "08:00" }],
      Date.parse("2020-01-01T00:00:00Z"),
    );

    expect(at).toBe(Date.parse("2027-05-15T01:00:00Z"));
  });

  it("has nothing to count once every event has passed", () => {
    // What stops an interval firing forever on a page somebody left open.
    expect(
      nearestUpcoming(
        [{ date: "2020-01-01", start_time: "08:00" }],
        Date.parse("2027-01-01T00:00:00Z"),
      ),
    ).toBeUndefined();
  });

  it("never counts below zero", () => {
    expect(remainingUntil(0, 1_000_000)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
  });

  it("breaks a duration into days, hours, minutes and seconds", () => {
    const target = Date.parse("2027-05-15T08:00:00Z");
    const now = Date.parse("2027-05-13T06:30:30Z");

    expect(remainingUntil(target, now)).toEqual({
      days: 2,
      hours: 1,
      minutes: 29,
      seconds: 30,
    });
  });

  it("renders labels before any number, so SSR and the client agree", () => {
    // The first render must not depend on the clock: a server-rendered second count is
    // guaranteed to disagree with the client's by hydration, and React replaces the
    // subtree when it does.
    const Component = COMPONENT_REGISTRY["EventCardDouble"]!;
    render(<Component {...props(FULL, { mode: "demo" })} />);

    const list = screen.getByLabelText(/hitung mundur/i);
    expect(list.textContent).toContain("Hari");
    expect(list.querySelectorAll("b")[0]?.textContent).toBe("—");
  });
});

describe("the gift section", () => {
  it("offers a copy button that announces the result", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const Component = COMPONENT_REGISTRY["GiftAccountList"]!;
    render(<Component {...props(FULL)} />);

    screen.getByRole("button", { name: /salin nomor/i }).click();
    expect(writeText).toHaveBeenCalledWith("1234567890");
  });

  it("disables the copy button outside the public page", () => {
    const Component = COMPONENT_REGISTRY["GiftAccountList"]!;
    render(<Component {...props(FULL, { mode: "demo" })} />);

    expect(screen.getByRole("button", { name: /salin nomor/i })).toBeDisabled();
  });
});

describe("the Phase 4 shells", () => {
  it.each(["RsvpForm", "GuestbookWall"])(
    "%s says its form is not live yet rather than silently doing nothing",
    (name) => {
      // A live-looking form whose handler is missing is the failure where a guest types a
      // message, presses send, sees nothing, and concludes the invitation is broken.
      const Component = COMPONENT_REGISTRY[name]!;
      render(<Component {...props(FULL)} />);

      expect(document.body.textContent).toContain("akan aktif");
      for (const control of document.querySelectorAll(
        "input, textarea, button",
      )) {
        expect(control).toBeDisabled();
      }
    },
  );

  it("labels every guestbook and RSVP control", () => {
    const Component = COMPONENT_REGISTRY["RsvpForm"]!;
    render(<Component {...props(FULL)} />);

    expect(screen.getByLabelText(/nama/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ucapan/i)).toBeInTheDocument();
  });
});

describe("the stylesheet", () => {
  it("honours prefers-reduced-motion", () => {
    // `docs/UI-UX/17`. A scroll reveal is decoration, and nothing here is the only way to
    // perceive anything -- which is the test for whether an animation may be removed
    // entirely rather than merely shortened.
    expect(SECTION_STYLES).toContain("@media (prefers-reduced-motion: reduce)");
    expect(SECTION_STYLES).toContain("animation-duration: 0.001ms !important");
  });

  it("gives every interactive control a visible focus ring", () => {
    // `docs/UI-UX/17`: keyboard-operable under decorative design. A theme cannot remove
    // this, because it is not expressed as a theme value.
    expect(SECTION_STYLES).toContain(".wi-button:focus-visible");
    expect(SECTION_STYLES).toContain(".wi-input:focus-visible");
  });

  it("meets the 44px touch target minimum on buttons and inputs", () => {
    expect(SECTION_STYLES).toContain("min-height: 44px");
  });
});
