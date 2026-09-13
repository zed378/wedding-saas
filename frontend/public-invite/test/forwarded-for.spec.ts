import { describe, expect, it } from "vitest";

import { forwardedForHeaders } from "../src/lib/forwarded-for";

/**
 * `P2-13` — the guest's address, carried across this server's hop. The SSR suite proves the
 * page actually sends it; this pins what is sent.
 */
describe("forwardedForHeaders", () => {
  it("sends nothing when there is nothing to forward", () => {
    expect(forwardedForHeaders(null)).toEqual({});
    expect(forwardedForHeaders(undefined)).toEqual({});
    expect(forwardedForHeaders("   ")).toEqual({});
  });

  it("forwards the header unchanged, never appending this server's address", () => {
    // Appending would shift the API's hop count by one and rate-limit Cloudflare's edge.
    expect(forwardedForHeaders("198.51.100.4, 203.0.113.7")).toEqual({
      "x-forwarded-for": "198.51.100.4, 203.0.113.7",
    });
  });

  it("keeps the right-hand end of a padded header, which is the part a proxy wrote", () => {
    const padded = `${"10.0.0.1, ".repeat(200)}198.51.100.4, 203.0.113.7`;

    const forwarded = forwardedForHeaders(padded)["x-forwarded-for"]!;

    expect(forwarded.length).toBeLessThanOrEqual(512);
    expect(forwarded.endsWith("198.51.100.4, 203.0.113.7")).toBe(true);
    // No half an address at the cut.
    expect(
      forwarded
        .split(",")
        .every((entry) => /^\s*\d+\.\d+\.\d+\.\d+$/.test(entry)),
    ).toBe(true);
  });
});
