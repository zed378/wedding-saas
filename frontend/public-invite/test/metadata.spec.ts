import { describe, expect, it } from "vitest";

import {
  buildEventJsonLd,
  buildMetadata,
  coupleNames,
  isIndexable,
} from "../src/lib/metadata";
import { safeJsonLd } from "../src/lib/json-ld";
import type { PublicInvitation } from "../src/lib/public-invitation";

/**
 * `P2-09` — the link preview and the privacy default.
 *
 * Two of the card's DoD items are really one question asked twice: **what can reach a
 * stranger who never opens the page?** A preview is rendered by WhatsApp, Facebook and
 * Telegram and cached on their servers; structured data is read by crawlers. Both are a
 * wider and far longer-lived audience than the invitation itself.
 *
 * So most of what follows asserts over the whole serialized result rather than over
 * individual fields. A test that checks `og:title` is right says nothing about what else
 * got in.
 */

const ORIGIN = "https://invitation.test";

const base: PublicInvitation = {
  status: "published",
  template: {
    sections: [],
    theme: {},
    customizable_theme_keys: [],
    thumbnail_url: "https://cdn.test/template-thumb.webp",
  },
  display: { watermark: false },
  invitation: {
    couple: {
      groom: { full_name: "Budi Santoso", nickname: "Budi" },
      bride: { full_name: "Siti Rahayu", nickname: "Siti" },
    },
    events: [
      {
        type: "akad",
        title: "Akad Nikah",
        date: "2027-05-15",
        start_time: "08:00",
        venue_name: "Masjid Agung Bandung",
        address: "Jl. Asia Afrika No. 1, Bandung",
      },
    ],
    gallery: {
      photos: [
        { url: "https://cdn.test/a.webp", is_cover: false, order: 0 },
        { url: "https://cdn.test/cover.webp", is_cover: true, order: 1 },
      ],
    },
    quote: { text: null, source: null },
    settings: {
      enabled_sections: ["hero"],
      rsvp_enabled: true,
      guestbook_enabled: true,
      seo_indexable: false,
    },
  },
};

/** `base`, with a deep override applied to `invitation.invitation`. */
const withInvitation = (
  patch: Partial<PublicInvitation["invitation"]>,
): PublicInvitation => ({
  ...base,
  invitation: { ...base.invitation, ...patch },
});

const withSettings = (
  patch: Partial<PublicInvitation["invitation"]["settings"]>,
): PublicInvitation =>
  withInvitation({
    settings: { ...base.invitation.settings, ...patch },
  });

const build = (invitation: PublicInvitation = base) =>
  buildMetadata({ invitation, slug: "andi-sarah", origin: ORIGIN });

// --------------------------------------------------------------- DoD 2: the default

describe("robots defaults to noindex", () => {
  it("is noindex when the owner has not enabled indexing", () => {
    // `docs/SECURITY/09`: the page carries guest names and, once `P4` lands, RSVP
    // replies. The default has to be the safe one.
    const meta = build();

    expect(meta.robots).toMatchObject({ index: false, follow: false });
  });

  it.each([
    ["the field is missing", undefined],
    ["the field is null", null],
    ["the field is the STRING true", "true"],
    ["the field is 1", 1],
  ])("is still noindex when %s", (_label, value) => {
    // Fails closed rather than open. A payload that lost the setting, or a future API
    // that serialized it differently, must not silently start indexing somebody's
    // wedding — the failure is invisible and the damage is cached by Google.
    const invitation = withSettings({
      seo_indexable: value as unknown as boolean,
    });

    expect(isIndexable(invitation)).toBe(false);
    expect(build(invitation).robots).toMatchObject({ index: false });
  });

  it("indexes only when the owner said exactly true", () => {
    const meta = build(withSettings({ seo_indexable: true }));

    expect(meta.robots).toMatchObject({ index: true, follow: true });
  });

  it("also asks Google not to keep an image when indexing is off", () => {
    // `index: false` alone leaves an already-indexed page's cached image in results.
    const meta = build();

    expect(meta.robots).toMatchObject({
      googleBot: { index: false, noimageindex: true },
    });
  });
});

// ------------------------------------------------------------- DoD 1: the preview card

describe("the preview card", () => {
  it("carries the couple, the date and the venue", () => {
    const meta = build();

    expect(meta.title).toBe("Undangan Pernikahan Budi & Siti");
    expect(meta.openGraph?.title).toBe("Undangan Pernikahan Budi & Siti");
    expect(String(meta.description)).toContain("2027-05-15");
    expect(String(meta.description)).toContain("Masjid Agung Bandung");
  });

  it("uses the large-image card, because the photo is the preview", () => {
    expect(build().twitter?.card).toBe("summary_large_image");
  });

  it("points at the invitation's canonical address", () => {
    const meta = build();

    expect(meta.alternates?.canonical).toBe(`${ORIGIN}/andi-sarah`);
    expect(meta.openGraph?.url).toBe(`${ORIGIN}/andi-sarah`);
  });

  it("still produces a title when neither name is filled in", () => {
    const meta = build(withInvitation({ couple: {} }));

    expect(meta.title).toBe("Undangan Pernikahan");
    expect(String(meta.description).length).toBeGreaterThan(0);
  });

  it("reads a nickname first and a full name second", () => {
    expect(coupleNames(base)).toBe("Budi & Siti");
    expect(
      coupleNames(
        withInvitation({
          couple: {
            groom: { full_name: "Budi Santoso" },
            bride: { full_name: "Siti Rahayu" },
          },
        }),
      ),
    ).toBe("Budi Santoso & Siti Rahayu");
  });
});

// ------------------------------------------------------------- DoD 4: the image fallback

describe("the preview image", () => {
  it("uses the photo marked as the cover, not the first one", () => {
    const meta = build();

    expect(meta.openGraph?.images).toEqual([
      { url: "https://cdn.test/cover.webp" },
    ]);
  });

  it("falls back to the template thumbnail when there is no cover photo", () => {
    // The DoD item, and the case that matters most in practice: a couple who has not
    // uploaded photos yet is exactly the couple testing what their link looks like.
    const meta = build(withInvitation({ gallery: { photos: [] } }));

    expect(meta.openGraph?.images).toEqual([
      { url: "https://cdn.test/template-thumb.webp" },
    ]);
    expect(meta.twitter?.images).toEqual([
      "https://cdn.test/template-thumb.webp",
    ]);
  });

  it("omits the image rather than inventing one when there is neither", () => {
    const meta = buildMetadata({
      invitation: {
        ...withInvitation({ gallery: { photos: [] } }),
        template: { ...base.template, thumbnail_url: null },
      },
      slug: "andi-sarah",
      origin: ORIGIN,
    });

    expect(meta.openGraph).not.toHaveProperty("images");
    expect(meta.twitter).not.toHaveProperty("images");
  });

  it("uses the first photo when none is marked as the cover", () => {
    const meta = build(
      withInvitation({
        gallery: { photos: [{ url: "https://cdn.test/first.webp", order: 0 }] },
      }),
    );

    expect(meta.openGraph?.images).toEqual([
      { url: "https://cdn.test/first.webp" },
    ]);
  });
});

// ------------------------------------------------------ DoD 3: structured data is clean

describe("the structured data", () => {
  const url = `${ORIGIN}/andi-sarah`;

  it("describes the ceremony and where it is", () => {
    const jsonLd = buildEventJsonLd(base, url);

    expect(jsonLd).toMatchObject({
      "@type": "Event",
      name: "Pernikahan Budi & Siti",
      startDate: "2027-05-15T08:00",
      url,
      location: { "@type": "Place", name: "Masjid Agung Bandung" },
    });
  });

  it("contains no account number and no guest information", () => {
    // The DoD item, asserted over the serialized object rather than over named fields —
    // a field added later would pass a field-by-field check.
    const invitation: PublicInvitation = {
      ...base,
      invitation: {
        ...base.invitation,
        gift: {
          accounts: [
            {
              type: "bank",
              provider_name: "BCA",
              account_number: "1234567890",
              account_holder: "Budi Santoso",
              order: 0,
            },
          ],
        },
      },
    };

    const serialized = JSON.stringify(buildEventJsonLd(invitation, url));

    for (const forbidden of [
      "1234567890",
      "BCA",
      "account",
      "attendee",
      "performer",
      "offers",
      "guest",
    ]) {
      expect(serialized.toLowerCase(), forbidden).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });

  it("exposes only the properties it was designed to", () => {
    const keys = Object.keys(buildEventJsonLd(base, url) ?? {}).sort();

    expect(keys).toEqual([
      "@context",
      "@type",
      "eventAttendanceMode",
      "eventStatus",
      "location",
      "name",
      "startDate",
      "url",
    ]);
  });

  it("is absent rather than empty when there is no event", () => {
    // Structured data that describes nothing is worse than none: a crawler believes it.
    expect(
      buildEventJsonLd(withInvitation({ events: [] }), url),
    ).toBeUndefined();
  });

  it("is absent when the event has no date", () => {
    expect(
      buildEventJsonLd(
        withInvitation({ events: [{ title: "Akad", venue_name: "Masjid" }] }),
        url,
      ),
    ).toBeUndefined();
  });

  it("omits the time rather than guessing one", () => {
    const jsonLd = buildEventJsonLd(
      withInvitation({ events: [{ date: "2027-05-15", title: "Akad" }] }),
      url,
    );

    expect(jsonLd?.["startDate"]).toBe("2027-05-15");
  });
});

describe("the JSON-LD script cannot be closed early", () => {
  it("escapes a venue name that tries to end the element", () => {
    // A venue name is user text. Inside a `<script>` element a `<` is not markup and the
    // only sequence that ends the element is `</script` — so a venue called
    // `</script><img onerror=...>` would otherwise run.
    const hostile = "</script><img src=x onerror=alert(1)>";
    const jsonLd = buildEventJsonLd(
      withInvitation({
        events: [{ date: "2027-05-15", title: "Akad", venue_name: hostile }],
      }),
      `${ORIGIN}/andi-sarah`,
    );

    const rendered = safeJsonLd(jsonLd ?? {});

    expect(rendered).not.toContain("</script");
    expect(rendered).not.toContain("<img");
    // Still the same value to a JSON parser, which is the point of the escape.
    expect(JSON.parse(rendered)).toMatchObject({
      location: { name: hostile },
    });
  });

  it("leaves ordinary content untouched", () => {
    expect(JSON.parse(safeJsonLd({ name: "Budi & Siti" }))).toEqual({
      name: "Budi & Siti",
    });
  });
});
