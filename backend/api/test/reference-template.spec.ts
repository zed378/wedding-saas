import { describe, it, expect } from "vitest";

import {
  collectMissingRequiredFields,
  isCanonicalFieldPath,
  sectionsSchema,
  validateTemplateVersion,
  type InvitationData,
  type SectionDefinition,
} from "@wi/schema";

import {
  loadDemoInvitation,
  loadReferenceTemplate,
  stripAnnotations,
} from "../src/infra/db/seed-data/load.mts";

/**
 * P0-21 step 6 — the reference template is checked against the `P0-20` schema here, so
 * that a later schema change which breaks the one template the product ships with fails
 * a test rather than a customer's page.
 *
 * These read the same bytes the seed reads. A test that parsed its own copy of the
 * template would pass happily while `db:seed` wrote something else.
 */

const template = loadReferenceTemplate();
const demo = loadDemoInvitation();

/** The parsed sections, or a failure loud enough to read. */
const sections = ((): readonly SectionDefinition[] => {
  const result = sectionsSchema.safeParse(template.sections);
  if (!result.success) {
    throw new Error(
      `the reference template does not parse:\n${JSON.stringify(result.error.issues, null, 2)}`,
    );
  }
  return result.data;
})();

describe("the reference template", () => {
  it("validates against the P0-20 schema", () => {
    // DoD item 2. If this fails, either the template drifted or the schema tightened --
    // and in the second case the schema change is not finished.
    const result = validateTemplateVersion({
      sections: template.sections,
      theme: template.theme,
      customizable_theme_keys: template.customizable_theme_keys,
    });

    expect(
      result.ok ? [] : result.errors.map((e) => `${e.field}: ${e.message}`),
      "the reference template must satisfy the schema the seed validates it against",
    ).toEqual([]);
  });

  it("references only paths in the canonical registry", () => {
    // DoD item 3. Redundant with the schema today -- and deliberately so: this is the
    // requirement the card states, and it should not depend on the validator continuing
    // to check it.
    const referenced = sections.flatMap((s) => [
      ...s.required_fields,
      ...s.optional_fields,
    ]);

    expect(referenced.filter((p) => !isCanonicalFieldPath(p))).toEqual([]);
    expect(referenced.length).toBeGreaterThan(0);
  });

  it("renders the ten sections in the docs/UI-UX/14 order", () => {
    // The order in the array IS the page order (docs/FRONTEND/04 step 1), so this is a
    // test of the product's default layout, not of a data structure.
    expect(sections.map((s) => s.section_key)).toEqual([
      "hero",
      "quote",
      "couple",
      "event",
      "gallery",
      "maps",
      "gift",
      "rsvp",
      "guestbook",
      "closing",
    ]);
  });

  it("makes hero and event non-configurable, and the rest configurable", () => {
    // The card, step 2: "hero and event are not user-disableable (an invitation without
    // event details is not an invitation)".
    const byKey = new Map(sections.map((s) => [s.section_key, s]));

    expect(byKey.get("hero")!.configurable).toBe(false);
    expect(byKey.get("event")!.configurable).toBe(false);

    for (const key of [
      "quote",
      "couple",
      "gallery",
      "maps",
      "gift",
      "rsvp",
      "guestbook",
      "closing",
    ] as const) {
      expect(byKey.get(key)!.configurable, key).toBe(true);
    }
  });

  it("defaults the gift section to off", () => {
    // A judgement rather than a mechanic: asking for money is a choice a couple makes
    // deliberately, and a gift section that appears unless you turn it off asks on
    // their behalf.
    expect(
      sections.find((s) => s.section_key === "gift")!.enabled_by_default,
    ).toBe(false);
  });

  it("exposes only colors.primary as customizable", () => {
    // Card step 3, and docs/PLAN/07 § Theme Variables: "start with colors.primary only".
    expect(template.customizable_theme_keys).toEqual(["colors.primary"]);
  });

  it("requires no field the guests supply", () => {
    // rsvp and guestbook entries arrive after publication. A required field there would
    // make publishing impossible by construction.
    const byKey = new Map(sections.map((s) => [s.section_key, s]));
    expect(byKey.get("rsvp")!.required_fields).toEqual([]);
    expect(byKey.get("guestbook")!.required_fields).toEqual([]);
  });

  it("is published at 1.0.0", () => {
    expect(template.version).toBe("1.0.0");
    expect(template.status).toBe("published");
    expect(template.template.status).toBe("published");
  });
});

/**
 * The demo content, shaped the way `docs/PLAN/08` describes and the public API will
 * return it (`docs/API/08`).
 *
 * This mapping is test-side on purpose. The real one belongs to the public invitation
 * endpoint, which is Phase 2/3 work and reads the database rather than this file. What
 * is asserted below is a property of the **seed data** — that the content it writes is
 * enough to satisfy the template it writes alongside it — and that question can be
 * answered without a database.
 */
function demoAsInvitationData(): InvitationData {
  const person = (role: string) =>
    demo.people.find((p) => p["role"] === role) as Record<string, unknown>;

  const asPerson = (p: Record<string, unknown>) => ({
    full_name: p["full_name"] as string,
    nickname: p["nickname"] as string,
    // A media reference. The demo has no profile photo: `couple.groom.photo` is in the
    // couple section's optional_fields, so null here is a deliberate demonstration that
    // an optional field may be absent without blocking publication.
    photo: null,
    instagram: p["instagram"] as string,
    father_name: p["father_name"] as string,
    mother_name: p["mother_name"] as string,
    child_order: p["child_order"] as string,
  });

  return {
    couple: {
      groom: asPerson(person("groom")),
      bride: asPerson(person("bride")),
    },
    events: demo.events.map((e) => ({
      type: e["type"] as "akad" | "reception" | "custom",
      title: e["title"] as string,
      // The column is `event_date`; the canonical path is `events.*.date`. The rename
      // happens once, here in the demo mapper and once in the public endpoint -- it is
      // the price of the domain vocabulary in docs/PLAN/08 differing from the column.
      date: e["event_date"] as string,
      start_time: e["start_time"] as string,
      end_time: e["end_time"] as string,
      venue_name: e["venue_name"] as string,
      address: e["address"] as string,
      latitude: e["latitude"] as string,
      longitude: e["longitude"] as string,
      maps_url: null,
      description: e["description"] as string,
    })),
    gallery: {
      photos: demo.gallery.map((g, index) => ({
        // The seed generates media ids; only presence matters to the resolver.
        media_id: `media-${index}`,
        caption: g.caption,
        order: g.display_order,
        is_cover: g.is_cover,
      })),
    },
    gift: {
      accounts: demo.gift_accounts.map((a) => ({
        type: a["type"] as "bank" | "ewallet",
        provider_name: a["provider_name"] as string,
        account_number: a["account_number"] as string,
        account_holder: a["account_holder"] as string,
        order: a["display_order"] as number,
      })),
    },
    quote: { text: demo.quote.text, source: demo.quote.source },
  };
}

describe("the demo invitation", () => {
  const data = demoAsInvitationData();

  it("fills every required field the reference template asks for", () => {
    // The test that matters. docs/UI-UX/11 needs the catalogue demo to set accurate
    // expectations; a demo missing a required field renders a section with a hole in it
    // on the one page whose job is showing what the product looks like.
    //
    // Checked against the sections the demo actually enables, plus the non-configurable
    // ones -- which is exactly what publish validation does (BR-4.2).
    const missing = collectMissingRequiredFields(
      sections,
      demo.settings.enabled_sections,
      data,
    );

    expect(
      missing.map((m) => `${m.sectionKey}: ${m.path}`),
      "the demo would not be publishable against its own template",
    ).toEqual([]);
  });

  it("would still be complete with every section enabled", () => {
    // The stricter version: even the gift section, which the demo leaves off, has the
    // data behind it. Without this, turning `gift` on in the admin preview would show
    // an empty section and nobody would know until they tried.
    const everySection = sections.map((s) => s.section_key);
    expect(
      collectMissingRequiredFields(sections, everySection, data).map(
        (m) => m.path,
      ),
    ).toEqual([]);
  });

  it("leaves the gift section disabled, exercising BR-4.1", () => {
    // The gift accounts are stored and not displayed. That is the rule: "sections not
    // supported by the active template are NOT displayed publicly, but the data remains
    // stored in the database".
    expect(demo.settings.enabled_sections).not.toContain("gift");
    expect(demo.gift_accounts.length).toBeGreaterThan(0);
  });

  it("does not list hero or event in enabled_sections", () => {
    // They are configurable: false, so docs/FRONTEND/04 step 2 renders them regardless.
    // Listing them would make the previous tests pass for the wrong reason.
    expect(demo.settings.enabled_sections).not.toContain("hero");
    expect(demo.settings.enabled_sections).not.toContain("event");
  });

  it("is never indexed", () => {
    // docs/UI-UX/11: reachable as a live demo, never listed. A demo invitation in
    // search results is a fake wedding with a real-looking address on it.
    expect(demo.settings.seo_indexable).toBe(false);
  });

  it("has two events, so wildcard completeness is actually exercised", () => {
    // With one event, `events.*.date` cannot distinguish "every element filled" from
    // "the only element filled", and the demo would stop proving the rule it looks
    // like it proves.
    expect(demo.events.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps an unmoderated guestbook entry pending", () => {
    // Moderation is on. An entry that is visible without approval would be a demo of a
    // feature working incorrectly.
    expect(demo.settings.guestbook_moderation).toBe(true);
    expect(demo.guestbook.some((g) => g["status"] === "pending")).toBe(true);
  });
});

describe("the annotation convention", () => {
  it("strips _-prefixed keys at every depth", () => {
    expect(
      stripAnnotations({
        _why: ["explanation"],
        keep: 1,
        nested: [{ _note: "x", value: 2 }],
      }),
    ).toEqual({ keep: 1, nested: [{ value: 2 }] });
  });

  it("leaves the loaded files with no annotation keys", () => {
    // Otherwise `.strict()` on the section schema would reject them, and the first
    // test in this file would be failing for a reason that has nothing to do with the
    // template's design.
    const keys = JSON.stringify([template, demo]).match(/"_[a-z_]+"/g);
    expect(keys).toBeNull();
  });
});
