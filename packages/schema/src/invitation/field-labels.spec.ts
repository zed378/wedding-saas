import { describe, expect, it } from "vitest";

import {
  CANONICAL_PATHS,
  FIELD_LABELS,
  KNOWN_SECTION_KEYS,
  SECTION_LABELS,
  describeMissingField,
  fieldLabel,
  sectionLabel,
} from "./field-labels.js";

/**
 * P2-06 — the labels, and the coverage that keeps them honest.
 *
 * The card's DoD: *"field paths never reach the user interface untranslated"*. A
 * `fieldLabel` that falls back to the path satisfies the type system and defeats the
 * requirement, so what is asserted here is that the fallback is never reached for any
 * path the product actually has.
 */
describe("every canonical field path has a label", () => {
  it("covers all of them", () => {
    const unlabelled = CANONICAL_PATHS.filter(
      (path) => FIELD_LABELS[path] === undefined,
    );

    // Adding a field to `docs/PLAN/08` without naming it here fails the build, which is
    // the same discipline `P1-23` put on the editor's own registry.
    expect(unlabelled).toEqual([]);
  });

  it("labels no path the registry does not know", () => {
    // The reverse direction. A label for a path nobody can store is dead text that looks
    // maintained -- and usually means a path was renamed and one side was updated.
    const orphans = Object.keys(FIELD_LABELS).filter(
      (path) => !CANONICAL_PATHS.includes(path),
    );

    expect(orphans).toEqual([]);
  });

  it("names every section", () => {
    const unlabelled = KNOWN_SECTION_KEYS.filter(
      (key) => SECTION_LABELS[key] === undefined,
    );

    expect(unlabelled).toEqual([]);
  });

  it("never returns an empty label", () => {
    for (const path of CANONICAL_PATHS) {
      expect(fieldLabel(path).trim().length, path).toBeGreaterThan(0);
    }
  });
});

describe("a label stands alone", () => {
  it("says whose field it is, because the checklist has no heading to lean on", () => {
    // The editor's own label can say just "Nama panggilan": it sits under a section
    // heading. This one appears in a flat list of everything left to do.
    expect(fieldLabel("couple.bride.nickname")).toBe(
      "Nama panggilan mempelai wanita",
    );
    expect(fieldLabel("couple.groom.nickname")).toBe(
      "Nama panggilan mempelai pria",
    );
  });

  it("distinguishes the two people", () => {
    expect(fieldLabel("couple.bride.full_name")).not.toBe(
      fieldLabel("couple.groom.full_name"),
    );
  });
});

describe("describeMissingField", () => {
  it("says what is missing and where to fix it", () => {
    expect(
      describeMissingField({
        sectionKey: "couple",
        path: "couple.bride.nickname",
      }),
    ).toBe("Nama panggilan mempelai wanita di bagian Mempelai");
  });

  it("contains no dot-notation path", () => {
    // The DoD, asserted against every combination the product can produce rather than
    // one example.
    for (const path of CANONICAL_PATHS) {
      for (const key of KNOWN_SECTION_KEYS) {
        expect(describeMissingField({ sectionKey: key, path })).not.toContain(
          path,
        );
      }
    }
  });
});

describe("the fallbacks", () => {
  it("returns the raw value for something unknown, rather than throwing", () => {
    // `P0-20` validates a definition's paths against the registry, so an unknown path
    // should be unreachable -- and a checklist that crashed would be worse than one
    // showing a path.
    expect(fieldLabel("not.a.real.path")).toBe("not.a.real.path");
    expect(sectionLabel("nonexistent")).toBe("nonexistent");
  });
});
