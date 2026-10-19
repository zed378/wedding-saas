import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { PageViewTracker } from "../src/components/PageViewTracker";
import { POST } from "../src/app/public/i/[slug]/view/route";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PageViewTracker (P4-09)", () => {
  it("emits page view beacon to /public/i/:slug/view via sendBeacon", () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon });

    render(<PageViewTracker slug="romeo-juliet" />);

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0]![0]).toBe("/public/i/romeo-juliet/view");
  });

  it("falls back to fetch with keepalive when sendBeacon returns false", () => {
    const sendBeacon = vi.fn(() => false);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("navigator", { sendBeacon });
    vi.stubGlobal("fetch", fetchMock);

    render(<PageViewTracker slug="romeo-juliet" />);

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/public/i/romeo-juliet/view", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
      keepalive: true,
    });
  });

  it("does not throw into the page when sendBeacon throws", () => {
    vi.stubGlobal("navigator", {
      sendBeacon: () => {
        throw new Error("blocked by privacy extension");
      },
    });

    expect(() => render(<PageViewTracker slug="romeo-juliet" />)).not.toThrow();
  });

  it("fires only once even if component re-renders", () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon });

    const { rerender } = render(<PageViewTracker slug="romeo-juliet" />);
    rerender(<PageViewTracker slug="romeo-juliet" />);

    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });
});

describe("the same-origin view forward route (P4-09)", () => {
  const request = (body: string = "{}", headers: Record<string, string> = {}) =>
    new Request("https://invitation.test/public/i/romeo-juliet/view", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...headers },
    });

  it("forwards the beacon to the API with x-forwarded-for headers", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", upstream);

    const response = await POST(
      request("{}", { "x-forwarded-for": "203.0.113.195" }),
      { params: Promise.resolve({ slug: "romeo-juliet" }) },
    );

    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toContain("/public/i/romeo-juliet/view");
    expect(init.method).toBe("POST");
    expect(init.headers["x-forwarded-for"]).toBe("203.0.113.195");
  });

  it("rejects excessively large payloads with 413", async () => {
    const largeBody = "x".repeat(1025);
    const response = await POST(request(largeBody), {
      params: Promise.resolve({ slug: "romeo-juliet" }),
    });

    expect(response.status).toBe(413);
  });

  it("swallows upstream API failures and returns 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("API offline")));

    const response = await POST(request(), {
      params: Promise.resolve({ slug: "romeo-juliet" }),
    });

    expect(response.status).toBe(204);
  });
});
