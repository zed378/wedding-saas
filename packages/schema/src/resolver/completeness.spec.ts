import { describe, it, expect } from "vitest";

import {
  collectMissingRequiredFields,
  isSectionEnabled,
  missingFieldPaths,
} from "./completeness.js";
import {
  sectionsSchema,
  type SectionDefinition,
} from "../template/section.schema.js";
import { COMPLETE_INVITATION } from "../testing/complete-invitation.js";

/**
 * P0-20 — BR-4.2, the publish gate.
 *
 * `docs/BACKEND/03` § Validating Completeness for Publishing. The sections here are
 * parsed through the real schema rather than hand-typed as objects, so a test cannot
 * accidentally assert against a definition the validator would have rejected.
 */

const parse = (input: unknown): readonly SectionDefinition[] => {
  const result = sectionsSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `fixture is not a valid section list: ${result.error.message}`,
    );
  }
  return result.data;
};

const SECTIONS = parse([
  {
    section_key: "hero",
    component: "HeroClassic",
    enabled_by_default: true,
    // Not configurable: docs/FRONTEND/04 step 2 renders it whatever the user chose.
    configurable: false,
    required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
  },
  {
    section_key: "event",
    component: "EventCardDouble",
    enabled_by_default: true,
    configurable: true,
    required_fields: ["events.*.date", "events.*.venue_name"],
  },
  {
    section_key: "gallery",
    component: "GalleryGrid",
    enabled_by_default: true,
    configurable: true,
    max_items: 20,
    required_fields: ["gallery.photos"],
    optional_fields: ["gallery.photos.*.caption"],
  },
]);

const ALL_ENABLED = ["hero", "event", "gallery"];

describe("isSectionEnabled", () => {
  it("respects enabled_sections for a configurable section", () => {
    const gallery = SECTIONS[2]!;
    expect(isSectionEnabled(gallery, ["gallery"])).toBe(true);
    expect(isSectionEnabled(gallery, [])).toBe(false);
  });

  it("always enables a non-configurable section", () => {
    // docs/FRONTEND/04 step 2: "unless configurable: false, in which case the section
    // must always show". The user cannot turn it off, so its fields are always required.
    expect(isSectionEnabled(SECTIONS[0]!, [])).toBe(true);
  });
});

describe("collectMissingRequiredFields", () => {
  it("reports nothing for a complete invitation", () => {
    expect(
      collectMissingRequiredFields(SECTIONS, ALL_ENABLED, COMPLETE_INVITATION),
    ).toEqual([]);
  });

  it("reports exactly the missing paths, with the section that needs each", () => {
    const data = { ...COMPLETE_INVITATION, gallery: { photos: [] } };

    expect(collectMissingRequiredFields(SECTIONS, ALL_ENABLED, data)).toEqual([
      { sectionKey: "gallery", path: "gallery.photos" },
    ]);
  });

  it("skips a section the user disabled (BR-4.1)", () => {
    // The data stays in the database; it is simply not displayed, so it cannot block
    // publication either.
    const data = { ...COMPLETE_INVITATION, gallery: { photos: [] } };

    expect(
      collectMissingRequiredFields(SECTIONS, ["hero", "event"], data),
    ).toEqual([]);
  });

  it("still checks a non-configurable section absent from enabled_sections", () => {
    // The case a naive `enabledSections.includes(key)` gets wrong: the hero renders
    // regardless, so publishing with an empty hero must be blocked.
    const missing = collectMissingRequiredFields(SECTIONS, [], {
      ...COMPLETE_INVITATION,
      couple: { groom: {}, bride: {} },
    });

    expect(missing.map((m) => m.path)).toEqual([
      "couple.groom.nickname",
      "couple.bride.nickname",
    ]);
  });

  it("blocks when one of two events is incomplete", () => {
    // The wildcard rule, from the caller's side. A page with one blank event card is
    // the outcome BR-4.2 exists to prevent.
    const data = {
      ...COMPLETE_INVITATION,
      events: [COMPLETE_INVITATION.events![0]!, { type: "reception" as const }],
    };

    expect(
      collectMissingRequiredFields(SECTIONS, ALL_ENABLED, data).map(
        (m) => m.path,
      ),
    ).toEqual(["events.*.date", "events.*.venue_name"]);
  });

  it("does not block on an optional field", () => {
    const data = {
      ...COMPLETE_INVITATION,
      gallery: { photos: [{ media_id: "m-1", order: 0, is_cover: true }] },
    };

    expect(collectMissingRequiredFields(SECTIONS, ALL_ENABLED, data)).toEqual(
      [],
    );
  });

  it("reports everything missing at once, in section then field order", () => {
    // Deterministic, because this list is both a 422 body and an editor checklist.
    const missing = collectMissingRequiredFields(SECTIONS, ALL_ENABLED, {});

    expect(missing).toEqual([
      { sectionKey: "hero", path: "couple.groom.nickname" },
      { sectionKey: "hero", path: "couple.bride.nickname" },
      { sectionKey: "event", path: "events.*.date" },
      { sectionKey: "event", path: "events.*.venue_name" },
      { sectionKey: "gallery", path: "gallery.photos" },
    ]);
  });

  it("keeps a path once per section that requires it", () => {
    const shared = parse([
      {
        section_key: "hero",
        component: "HeroClassic",
        enabled_by_default: true,
        configurable: false,
        required_fields: ["quote.text"],
      },
      {
        section_key: "quote",
        component: "QuoteBanner",
        enabled_by_default: true,
        configurable: true,
        required_fields: ["quote.text"],
      },
    ]);

    const missing = collectMissingRequiredFields(shared, ["quote"], {});
    expect(missing.map((m) => m.sectionKey)).toEqual(["hero", "quote"]);
    expect(missingFieldPaths(missing)).toEqual(["quote.text"]);
  });
});
