import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchCatalog,
  fetchDemoInvitation,
  fetchTemplate,
} from "../src/lib/catalog-api";

/**
 * `P2-11` — the catalogue's server-side fetchers.
 *
 * What each does with a failure is the behaviour worth pinning, because each page makes a
 * different promise: the catalogue must not say "no templates" during an outage, the
 * detail page must 404 for a template that does not exist, and the section previews must
 * never turn a complete detail page into an error page.
 */

const config = {
  apiBaseUrl: "http://api.test",
  publicInviteOrigin: "https://invitation.test",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub(response: Response | (() => Promise<Response>)) {
  const spy = vi.fn(() =>
    typeof response === "function" ? response() : Promise.resolve(response),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("fetchCatalog", () => {
  it("calls the anonymous catalogue with the API's parameter names", async () => {
    const spy = stub(
      json({
        success: true,
        data: [],
        meta: { page: 1, per_page: 12, total: 0 },
      }),
    );

    await fetchCatalog({ page: 2, premium: "true" }, config);

    const url = new URL(spy.mock.calls[0]![0] as unknown as string);
    expect(url.pathname).toBe("/api/v1/templates");
    expect(url.searchParams.get("is_premium")).toBe("true");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("returns the items and the paging meta", async () => {
    stub(
      json({
        success: true,
        data: [{ id: "t1", slug: "elegant-rose", name: "Elegant Rose" }],
        meta: { page: 1, per_page: 12, total: 13 },
      }),
    );

    const page = await fetchCatalog({ page: 1 }, config);

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(13);
  });

  it("throws on a failure rather than returning an empty catalogue", async () => {
    // "No templates yet" during an outage tells a visitor the product is empty.
    stub(new Response(null, { status: 503 }));

    await expect(fetchCatalog({ page: 1 }, config)).rejects.toThrow();
  });

  it("throws on a body that is not a success envelope", async () => {
    stub(json({ success: false, error: {} }));

    await expect(fetchCatalog({ page: 1 }, config)).rejects.toThrow();
  });
});

describe("fetchTemplate", () => {
  it("is null for a 404", async () => {
    stub(new Response(null, { status: 404 }));

    expect(await fetchTemplate("nope", config)).toBeNull();
  });

  it("is null for a 400, which is how the API answers a malformed slug", async () => {
    stub(new Response(null, { status: 400 }));

    expect(await fetchTemplate("Bad Slug!", config)).toBeNull();
  });

  it("throws for anything else, so an outage is not a missing template", async () => {
    stub(new Response(null, { status: 500 }));

    await expect(fetchTemplate("elegant-rose", config)).rejects.toThrow();
  });

  it("encodes the slug into the path", async () => {
    const spy = stub(json({ success: true, data: { slug: "x" } }));

    await fetchTemplate("a/b", config);

    expect(spy.mock.calls[0]![0]).toBe(
      "http://api.test/api/v1/templates/a%2Fb",
    );
  });
});

describe("fetchDemoInvitation", () => {
  it("reads the PUBLIC invitation API, not a fixture", async () => {
    // `docs/PLAN/07` § Demo Data: the demo renders from the production public payload.
    const spy = stub(
      json({
        success: true,
        data: {
          template: { sections: [], theme: {} },
          invitation: { settings: { enabled_sections: [] } },
        },
      }),
    );

    await fetchDemoInvitation("demo-elegant-rose", config);

    expect(spy.mock.calls[0]![0]).toBe(
      "http://api.test/public/i/demo-elegant-rose",
    );
  });

  it.each([
    ["a 404", () => Promise.resolve(new Response(null, { status: 404 }))],
    ["a 500", () => Promise.resolve(new Response(null, { status: 500 }))],
    ["a network failure", () => Promise.reject(new Error("ECONNREFUSED"))],
    [
      "a malformed body",
      () => Promise.resolve(json({ success: true, data: { template: {} } })),
    ],
  ])("is null, never a throw, for %s", async (_label, respond) => {
    // The previews are an enhancement. A detail page must not become an error page because
    // the demo could not be read.
    stub(respond);

    await expect(fetchDemoInvitation("demo", config)).resolves.toBeNull();
  });
});
