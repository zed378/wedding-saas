import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPublicInvitation } from "../src/lib/public-invitation";

/**
 * `P2-08` step 2 — the server-side fetch, and what it does when the API misbehaves.
 *
 * The distinction this file exists to pin: **404 is not an error and an error is not a
 * 404**. A page that renders "this invitation does not exist" during an API outage tells
 * a couple's guests something false and permanent-sounding, on the one day it matters
 * most. So a 404 returns `null` and everything else throws, and the page treats the two
 * completely differently.
 */

const BASE = "http://api.test";

const envelope = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const valid = {
  status: "published",
  template: { sections: [], theme: {}, customizable_theme_keys: [] },
  display: { watermark: true },
  invitation: {
    couple: {},
    events: [],
    gallery: { photos: [] },
    quote: {},
    settings: {
      enabled_sections: [],
      rsvp_enabled: true,
      guestbook_enabled: true,
      seo_indexable: false,
    },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response | (() => Response)) {
  const spy = vi.fn(() =>
    Promise.resolve(typeof response === "function" ? response() : response),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("the request", () => {
  it("asks the public route on the internal API", async () => {
    const spy = stubFetch(envelope(valid));

    await fetchPublicInvitation("andi-sarah", { baseUrl: BASE });

    expect(spy).toHaveBeenCalledWith(
      "http://api.test/public/i/andi-sarah",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("tolerates a base URL with a trailing slash", async () => {
    const spy = stubFetch(envelope(valid));

    await fetchPublicInvitation("andi-sarah", { baseUrl: `${BASE}/` });

    expect(spy.mock.calls[0]?.[0]).toBe("http://api.test/public/i/andi-sarah");
  });

  it("does not cache, because there is nothing to invalidate with yet", async () => {
    // `docs/ARCHITECTURE/06` wants this cached with event-driven invalidation, and the
    // event arrives with `P3-09`. Asserted so that turning caching on is a deliberate
    // change with a failing test attached, rather than a default nobody chose.
    const spy = stubFetch(envelope(valid));

    await fetchPublicInvitation("andi-sarah", { baseUrl: BASE });

    expect(spy.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store" });
  });
});

describe("404 means not published", () => {
  it("returns null", async () => {
    stubFetch(new Response(null, { status: 404 }));

    expect(
      await fetchPublicInvitation("andi-sarah", { baseUrl: BASE }),
    ).toBeNull();
  });
});

describe("anything else is a failure, not a missing invitation", () => {
  it.each([500, 502, 503, 429, 401])("throws on %i", async (status) => {
    stubFetch(new Response(null, { status }));

    await expect(
      fetchPublicInvitation("andi-sarah", { baseUrl: BASE }),
    ).rejects.toThrow();
  });

  it("propagates a network failure rather than swallowing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );

    await expect(
      fetchPublicInvitation("andi-sarah", { baseUrl: BASE }),
    ).rejects.toThrow("ECONNREFUSED");
  });
});

describe("the envelope is checked, not assumed", () => {
  it.each([
    ["an error envelope arriving with 200", { success: false, error: {} }],
    ["no data", { success: true }],
    ["data that is not an object", { success: true, data: "nope" }],
    [
      "a status other than published",
      { success: true, data: { ...valid, status: "draft" } },
    ],
    [
      "a template with no sections array",
      { success: true, data: { ...valid, template: { theme: {} } } },
    ],
    [
      "no invitation object",
      { success: true, data: { ...valid, invitation: null } },
    ],
  ])("returns null for %s", async (_label, body) => {
    stubFetch(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    expect(
      await fetchPublicInvitation("andi-sarah", { baseUrl: BASE }),
    ).toBeNull();
  });

  it("returns the invitation when the shape is right", async () => {
    stubFetch(envelope(valid));

    const result = await fetchPublicInvitation("andi-sarah", {
      baseUrl: BASE,
    });

    expect(result?.status).toBe("published");
    expect(result?.display.watermark).toBe(true);
  });
});
