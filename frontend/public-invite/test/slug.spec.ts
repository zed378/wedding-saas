import { describe, expect, it } from "vitest";

import { resolveSlug } from "../src/lib/slug";

/**
 * `P2-08` step 1. `docs/BACKEND/06` § Slug Resolution & Routing.
 *
 * Both strategies are tested now, though only `path` is configured at MVP. The document's
 * reason for one implementation is that the two must not drift, and a `subdomain` branch
 * with no tests is exactly how it would — the day it is switched on is the day nobody
 * remembers what it was supposed to do.
 */

describe("the path strategy", () => {
  it("takes the single path segment", () => {
    expect(resolveSlug("path", { pathname: "/andi-sarah" })).toBe("andi-sarah");
    expect(resolveSlug("path", { pathname: "/andi-sarah/" })).toBe(
      "andi-sarah",
    );
  });

  it("refuses a deeper path", () => {
    // `/andi-sarah/gallery` is not the invitation at a sub-page — it is an address that
    // does not exist. Serving the invitation there would give it a second URL, which is
    // a duplicate for a crawler and a wrong `og:url` for a share.
    expect(resolveSlug("path", { pathname: "/andi-sarah/gallery" })).toBe(
      undefined,
    );
  });

  it("refuses the bare host", () => {
    expect(resolveSlug("path", { pathname: "/" })).toBe(undefined);
    expect(resolveSlug("path", { pathname: "" })).toBe(undefined);
  });

  it("normalizes case and surrounding space before validating", () => {
    // The other order rejects `Andi-Sarah` outright. A guest who typed the address from
    // a printed card should reach the invitation, and the editor stores it lowercase.
    expect(resolveSlug("path", { pathname: "/ANDI-Sarah" })).toBe("andi-sarah");
  });

  it("decodes the segment", () => {
    expect(resolveSlug("path", { pathname: "/andi%2Dsarah" })).toBe(
      "andi-sarah",
    );
  });

  it("survives a malformed percent sequence", () => {
    // `decodeURIComponent` throws on this. On a public endpoint a throw is a 500, and a
    // 500 is a different response from a 404 — which makes it an oracle.
    expect(resolveSlug("path", { pathname: "/%zz" })).toBe(undefined);
  });

  it.each([
    ["too short", "/ab"],
    ["too long", `/${"a".repeat(51)}`],
    ["a leading hyphen", "/-andi"],
    ["a trailing hyphen", "/andi-"],
    ["a double hyphen at the edge", "/-"],
    ["an underscore", "/andi_sarah"],
    ["a dot", "/andi.sarah"],
    ["a space", "/andi sarah"],
    ["a traversal attempt", "/..%2F..%2Fetc"],
  ])("refuses %s", (_label, pathname) => {
    expect(resolveSlug("path", { pathname })).toBe(undefined);
  });
});

describe("the subdomain strategy", () => {
  it("takes the leading label", () => {
    expect(
      resolveSlug("subdomain", {
        host: "andi-sarah.invitation.vizunicum.my.id",
      }),
    ).toBe("andi-sarah");
  });

  it("ignores the port a proxy may or may not have stripped", () => {
    expect(
      resolveSlug("subdomain", { host: "andi-sarah.invitation.test:3200" }),
    ).toBe("andi-sarah");
  });

  it("refuses the bare host", () => {
    expect(
      resolveSlug("subdomain", { host: "invitation.vizunicum.my.id" }),
    ).toBe(undefined);
  });

  it.each(["www", "invitation", "preview"])(
    "refuses the reserved label %s",
    (label) => {
      expect(
        resolveSlug("subdomain", { host: `${label}.invitation.example.com` }),
      ).toBe(undefined);
    },
  );

  it("applies the same shape rule as the path strategy", () => {
    // The point of one implementation. A `Host` header is set by whatever reached the
    // proxy and is no more a fact than a path segment is.
    expect(
      resolveSlug("subdomain", { host: "an_di.invitation.example.com" }),
    ).toBe(undefined);
    expect(
      resolveSlug("subdomain", { host: "ab.invitation.example.com" }),
    ).toBe(undefined);
  });

  it("reads nothing from the path", () => {
    expect(
      resolveSlug("subdomain", { pathname: "/andi-sarah", host: undefined }),
    ).toBe(undefined);
  });
});
