import { describe, it, expect } from "vitest";

import {
  INVITATION_FIELDS,
  INVITATION_FIELD_PATHS,
  fieldDefinition,
  isCanonicalFieldPath,
  suggestFieldPaths,
} from "./field-registry.js";
import { COMPLETE_INVITATION } from "../testing/complete-invitation.js";
import { resolvePath, isEmpty } from "../resolver/resolve-path.js";

/**
 * P0-20 — the registry, checked against something other than itself.
 *
 * The `P0-12` lesson, learned twice: a test generated from the code it tests verifies
 * consistency, never correctness. So the first test here walks every registered path
 * against a **hand-written** invitation object. If a path is misspelled, or names a
 * field the data model does not have, it resolves to nothing and the test says which.
 */

describe("the canonical field registry", () => {
  it("has no duplicate paths", () => {
    const seen = new Set(INVITATION_FIELD_PATHS);
    expect(seen.size).toBe(INVITATION_FIELD_PATHS.length);
  });

  it("resolves every registered path against a complete invitation", () => {
    // The load-bearing test. A path nothing can reach is a path that renders an empty
    // section on every invitation that uses it, silently, forever.
    const unreachable = INVITATION_FIELD_PATHS.filter((path) =>
      isEmpty(resolvePath(COMPLETE_INVITATION, path)),
    );

    expect(
      unreachable,
      "paths that resolve to nothing in a complete invitation",
    ).toEqual([]);
  });

  it("covers both people, all eleven event fields, and every collection", () => {
    // Named counts rather than a total, so adding a field to one entity cannot be
    // absorbed by removing one from another.
    const under = (prefix: string) =>
      INVITATION_FIELD_PATHS.filter((p) => p.startsWith(prefix));

    expect(under("couple.groom.")).toHaveLength(7);
    expect(under("couple.bride.")).toHaveLength(7);
    expect(under("events.*.")).toHaveLength(11);
    expect(under("gallery.photos.*.")).toHaveLength(4);
    expect(under("gift.accounts.*.")).toHaveLength(5);
    expect(under("quote.")).toHaveLength(2);
  });

  it("marks exactly the three collections as collections", () => {
    const collections = INVITATION_FIELDS.filter(
      (f) => f.kind === "collection",
    ).map((f) => f.path);
    expect(collections).toEqual(["events", "gallery.photos", "gift.accounts"]);
  });

  it("excludes settings — a template selects content, not configuration", () => {
    // docs/PLAN/08: enabled_sections, slug and the toggles are how an invitation
    // configures a template. A template requiring `settings.slug` inverts that.
    expect(
      INVITATION_FIELD_PATHS.filter((p) => p.startsWith("settings")),
    ).toEqual([]);
  });

  it("excludes guest-submitted data — requiring it would make publishing impossible", () => {
    // RSVP and guestbook entries arrive after publication, by definition.
    const guestSubmitted = INVITATION_FIELD_PATHS.filter(
      (p) => p.startsWith("rsvp") || p.startsWith("guestbook"),
    );
    expect(guestSubmitted).toEqual([]);
  });

  it("names the table behind every path", () => {
    // The `source` field is the reader's way to check the registry against the schema
    // without trusting this file. A blank one is a claim nobody can verify.
    for (const field of INVITATION_FIELDS) {
      expect(field.source, field.path).toMatch(/^invitation_/);
    }
  });
});

describe("isCanonicalFieldPath", () => {
  it("accepts a registered path", () => {
    expect(isCanonicalFieldPath("couple.groom.nickname")).toBe(true);
  });

  it("rejects a typo", () => {
    expect(isCanonicalFieldPath("couple.groom.nickmame")).toBe(false);
  });

  it("rejects a prefix of a registered path", () => {
    // `couple.groom` is a real object but not a field a template may require -- the
    // emptiness question has no sensible answer for a whole person.
    expect(isCanonicalFieldPath("couple.groom")).toBe(false);
  });

  it("rejects a prototype-pollution shaped path", () => {
    expect(isCanonicalFieldPath("__proto__.polluted")).toBe(false);
    expect(isCanonicalFieldPath("constructor.prototype.x")).toBe(false);
  });
});

describe("suggestFieldPaths", () => {
  it("suggests the near miss for a typo", () => {
    expect(suggestFieldPaths("couple.groom.nickmame")).toContain(
      "couple.groom.nickname",
    );
  });

  it("returns nothing for a path with no plausible neighbour", () => {
    expect(suggestFieldPaths("zzz")).toEqual([]);
  });

  it("returns at most the requested number", () => {
    expect(suggestFieldPaths("events.*.d", 2).length).toBeLessThanOrEqual(2);
  });
});

describe("fieldDefinition", () => {
  it("returns the definition for a registered path", () => {
    expect(fieldDefinition("events.*.date")).toMatchObject({
      kind: "scalar",
      source: "invitation_events",
    });
  });

  it("returns undefined for an unregistered path", () => {
    expect(fieldDefinition("nope")).toBeUndefined();
  });
});
