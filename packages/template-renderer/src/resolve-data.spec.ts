import { describe, expect, it } from "vitest";

import { readPath, resolveSectionData } from "./resolve-data.js";

/**
 * P2-02 step 4 — the resolver, on its own.
 *
 * These properties were first asserted through the renderer, against stand-in components
 * that serialised their props into the DOM. `P2-03` replaced those with real components
 * and the assertions stopped meaning anything — which the `P2-02` record predicted in its
 * "What to Watch".
 *
 * The lesson is worth keeping: a property of a pure function was being checked through
 * two layers of rendering. Here it is checked where it lives, and no future component
 * change can make these vacuous.
 */

const DATA = {
  couple: {
    groom: { nickname: "Budi", full_name: "Budi Santoso" },
    bride: { nickname: "Siti", full_name: "Siti Nurhaliza" },
  },
  events: [
    { title: "Akad Nikah", venue_name: "Masjid Agung", type: "akad" },
    { title: "Resepsi", venue_name: "Gedung Merdeka", type: "reception" },
  ],
  gift: { accounts: [{ account_number: "1234567890", provider_name: "BCA" }] },
};

describe("the section data subset", () => {
  it("includes only the paths the section declared", () => {
    const resolved = resolveSectionData(DATA, ["couple.groom.nickname"]);

    expect(resolved).toEqual({ couple: { groom: { nickname: "Budi" } } });
  });

  it("does not leak a sibling the section did not ask for", () => {
    // The gift accounts have no business in the hero's props, and a component handed the
    // whole invitation could read them whatever its `required_fields` said.
    const resolved = resolveSectionData(DATA, ["couple.groom.nickname"]);

    expect(JSON.stringify(resolved)).not.toContain("1234567890");
    expect(JSON.stringify(resolved)).not.toContain("Nurhaliza");
  });

  it("groups a collection by element rather than flattening it", () => {
    const resolved = resolveSectionData(DATA, [
      "events.*.title",
      "events.*.venue_name",
    ]);

    // Each event keeps its own title and venue together. Two parallel lists could not be
    // rendered as cards, which is the shape `EventCardDouble` needs.
    expect(resolved).toEqual({
      events: [
        { title: "Akad Nikah", venue_name: "Masjid Agung" },
        { title: "Resepsi", venue_name: "Gedung Merdeka" },
      ],
    });
  });

  it("narrows collection elements to the declared fields only", () => {
    const resolved = resolveSectionData(DATA, ["events.*.title"]);

    // `type` exists on every event and was not asked for.
    expect(resolved).toEqual({
      events: [{ title: "Akad Nikah" }, { title: "Resepsi" }],
    });
  });

  it("omits an absent field rather than setting it to undefined", () => {
    // `docs/PLAN/07` § Required vs Optional: the cheapest way to leave no empty box is
    // for the key never to arrive.
    const resolved = resolveSectionData(
      { couple: { groom: { nickname: "Budi" } } },
      ["couple.groom.nickname", "couple.groom.instagram"],
    );

    expect(resolved).toEqual({ couple: { groom: { nickname: "Budi" } } });
    expect(
      "instagram" in ((resolved["couple"] as never)["groom"] as object),
    ).toBe(false);
  });

  it("skips a collection path when the collection is not an array", () => {
    expect(
      resolveSectionData({ events: "not an array" }, ["events.*.title"]),
    ).toEqual({});
  });

  it("returns an empty object for a path that resolves to nothing", () => {
    expect(resolveSectionData({}, ["couple.groom.nickname"])).toEqual({});
  });
});

describe("readPath does not walk out of the object graph", () => {
  it("reads a plain nested value", () => {
    expect(readPath(DATA, ["couple", "groom", "nickname"])).toBe("Budi");
  });

  it("refuses an inherited key", () => {
    // Without the `hasOwnProperty` check this returns `Object`, and a section definition
    // of `constructor.prototype` would reach the language rather than the data.
    expect(readPath({}, ["constructor"])).toBeUndefined();
    expect(readPath({}, ["__proto__"])).toBeUndefined();
    expect(readPath({}, ["toString"])).toBeUndefined();
  });

  it("stops at a non-object rather than throwing", () => {
    expect(readPath({ a: 1 }, ["a", "b"])).toBeUndefined();
    expect(readPath(null, ["a"])).toBeUndefined();
  });
});

describe("a section path cannot write to the prototype", () => {
  it("ignores __proto__ in a declared path", () => {
    const resolved = resolveSectionData(
      JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>,
      ["__proto__.polluted"],
    );

    expect(resolved).toEqual({});
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});
