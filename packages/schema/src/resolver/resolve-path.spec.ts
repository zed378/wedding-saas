import { describe, it, expect } from "vitest";

import { resolvePath, isEmpty, isPathMissing } from "./resolve-path.js";
import { COMPLETE_INVITATION } from "../testing/complete-invitation.js";

/**
 * P0-20 — the resolver.
 *
 * The DoD asks for the emptiness semantics to be "explicit and tested — empty string,
 * empty array, and null all count as missing for publish validation (BR-4.2)". The
 * cases that carry the most weight are the three that must **not** count: `0`, `false`
 * and `"0"`. A `!value` check gets all three wrong and passes every test that only
 * looks at the empty ones.
 */

describe("resolvePath", () => {
  it("resolves a nested scalar", () => {
    expect(resolvePath(COMPLETE_INVITATION, "couple.groom.nickname")).toBe(
      "Budi",
    );
  });

  it("resolves a collection to the array itself", () => {
    expect(resolvePath(COMPLETE_INVITATION, "events")).toHaveLength(2);
  });

  it("resolves a wildcard to one entry per element, in order", () => {
    expect(resolvePath(COMPLETE_INVITATION, "events.*.type")).toEqual([
      "akad",
      "reception",
    ]);
  });

  it("keeps the holes in a wildcard result rather than filtering them out", () => {
    // The information isPathMissing needs. A filtered result would report a collection
    // with one filled element and one empty one as complete.
    const data = { events: [{ date: "2026-11-14" }, {}] };
    expect(resolvePath(data, "events.*.date")).toEqual([
      "2026-11-14",
      undefined,
    ]);
  });

  it("returns undefined for an absent key", () => {
    expect(
      resolvePath(COMPLETE_INVITATION, "couple.groom.nickmame"),
    ).toBeUndefined();
  });

  it("returns undefined when a parent is absent, without throwing", () => {
    // The half-filled draft case. Throwing here would turn publish into a 500 that
    // tells the user nothing.
    expect(() => resolvePath({}, "couple.groom.nickname")).not.toThrow();
    expect(resolvePath({}, "couple.groom.nickname")).toBeUndefined();
  });

  it("returns undefined when a parent is null", () => {
    expect(
      resolvePath({ couple: null }, "couple.groom.nickname"),
    ).toBeUndefined();
  });

  it("returns undefined for a wildcard over something that is not a collection", () => {
    expect(
      resolvePath({ events: "not an array" }, "events.*.date"),
    ).toBeUndefined();
  });

  it("resolves a numeric segment into an array", () => {
    expect(resolvePath(COMPLETE_INVITATION, "events.1.venue_name")).toBe(
      "Gedung Serbaguna Merdeka",
    );
  });

  it("refuses __proto__, constructor and prototype segments", () => {
    // The second lock. The registry check rejects such a path first; this holds if that
    // one is ever bypassed or removed.
    expect(resolvePath({}, "__proto__.polluted")).toBeUndefined();
    expect(resolvePath({}, "constructor.name")).toBeUndefined();
    expect(resolvePath({}, "prototype.x")).toBeUndefined();
  });

  it("does not let an inherited key answer for the object", () => {
    const parent = { inherited: "leaked" };
    const child = Object.create(parent) as Record<string, unknown>;
    child["own"] = "fine";

    expect(resolvePath(child, "own")).toBe("fine");
    expect(resolvePath(child, "inherited")).toBeUndefined();
  });
});

describe("isEmpty", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["a whitespace-only string", "   "],
    ["a newline-only string", "\n\t"],
    ["an empty array", []],
    ["an empty object", {}],
    ["an invalid date", new Date("nope")],
  ])("treats %s as empty", (_label, value) => {
    expect(isEmpty(value)).toBe(true);
  });

  it.each([
    ["zero", 0],
    ["false", false],
    ["the string zero", "0"],
    ["a non-empty array", [1]],
    ["an object with a key", { a: 1 }],
    ["a valid date", new Date("2026-11-14")],
  ])("does not treat %s as empty", (_label, value) => {
    // These four are why isEmpty is a function and not `!value`. `order: 0` and
    // `is_cover: false` are legitimate stored values.
    expect(isEmpty(value)).toBe(false);
  });
});

describe("isPathMissing", () => {
  it("reports a filled scalar as present", () => {
    expect(isPathMissing(COMPLETE_INVITATION, "couple.groom.nickname")).toBe(
      false,
    );
  });

  it("reports an absent scalar as missing", () => {
    expect(isPathMissing({}, "couple.groom.nickname")).toBe(true);
  });

  it("reports a whitespace-only scalar as missing", () => {
    const data = { couple: { groom: { nickname: "   " } } };
    expect(isPathMissing(data, "couple.groom.nickname")).toBe(true);
  });

  it("reports `false` and `0` as present", () => {
    expect(
      isPathMissing(COMPLETE_INVITATION, "gallery.photos.*.is_cover"),
    ).toBe(false);
    expect(isPathMissing(COMPLETE_INVITATION, "gallery.photos.*.order")).toBe(
      false,
    );
  });

  it("reports an empty collection as missing", () => {
    expect(isPathMissing({ gallery: { photos: [] } }, "gallery.photos")).toBe(
      true,
    );
  });

  it("reports a wildcard over an empty collection as missing", () => {
    expect(isPathMissing({ events: [] }, "events.*.date")).toBe(true);
  });

  it("reports a wildcard as missing when ANY element is empty", () => {
    // The fail-closed choice, and the one worth stating: two events where one has no
    // date is not a publishable invitation. The other reading publishes a page with a
    // blank event card on it.
    const data = { events: [{ date: "2026-11-14" }, { date: null }] };
    expect(isPathMissing(data, "events.*.date")).toBe(true);
  });

  it("reports a wildcard as present only when every element is filled", () => {
    expect(isPathMissing(COMPLETE_INVITATION, "events.*.date")).toBe(false);
  });

  it("does not report a nested wildcard array as present just because it is an array", () => {
    // Without the flatten, `[[undefined]]` is a non-empty array and would read as
    // filled. There is no two-wildcard path in the registry today; this keeps the
    // answer right if one is ever added.
    const data = { outer: [{ inner: [{ v: null }] }] };
    expect(isPathMissing(data, "outer.*.inner.*.v")).toBe(true);
  });
});
