import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

/**
 * `P2-13` step 5 — the RUM reporter and the same-origin forward.
 *
 * The property that matters most is what a report does **not** contain: no URL, because a
 * preview URL is a credential and an invitation URL names a couple.
 */

let report: ((metric: Record<string, unknown>) => void) | undefined;

vi.mock("next/web-vitals", () => ({
  useReportWebVitals: (callback: (metric: Record<string, unknown>) => void) => {
    report = callback;
  },
}));

const { WebVitals } = await import("../src/components/WebVitals");
const { POST } = await import("../src/app/public/rum/route");

beforeEach(() => {
  report = undefined;
  window.history.replaceState({}, "", "/preview/SECRET-TOKEN-IN-THE-PATH");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const lcp = {
  name: "LCP",
  value: 1830.5,
  rating: "good",
  id: "v5-1",
  delta: 1830.5,
  navigationType: "navigate",
};

async function beaconBody(spy: ReturnType<typeof vi.fn>): Promise<string> {
  const blob = spy.mock.calls[0]![1] as Blob;
  return blob.text();
}

describe("the reporter", () => {
  it("beacons the metric, its rating and the page kind to the same origin", async () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon });

    render(<WebVitals pageKind="preview" />);
    report!(lcp);

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0]![0]).toBe("/public/rum");
    expect(JSON.parse(await beaconBody(sendBeacon))).toEqual({
      metric: "LCP",
      value: 1830.5,
      rating: "good",
      page_kind: "preview",
    });
  });

  it("never sends the page's URL, which for a preview contains the token", async () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon });

    render(<WebVitals pageKind="preview" />);
    report!(lcp);

    const body = await beaconBody(sendBeacon);
    expect(body).not.toContain("SECRET-TOKEN");
    expect(body).not.toContain("/preview");
  });

  it("falls back to a keepalive fetch where sendBeacon is missing", () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", fetchSpy);

    render(<WebVitals pageKind="invitation" />);
    report!(lcp);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/public/rum",
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
  });

  it("ignores metrics the API does not accept", () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon });

    render(<WebVitals pageKind="invitation" />);
    report!({ ...lcp, name: "Next.js-hydration" });

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("never throws into the page when reporting fails", () => {
    vi.stubGlobal("navigator", {
      sendBeacon: () => {
        throw new Error("blocked by an extension");
      },
    });

    render(<WebVitals pageKind="invitation" />);

    expect(() => report!(lcp)).not.toThrow();
  });
});

describe("the same-origin forward", () => {
  const request = (body: string, headers: Record<string, string> = {}) =>
    new Request("https://invitation.test/public/rum", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...headers },
    });

  it("forwards the body and the client's forwarded address to the API", async () => {
    const upstream = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal("fetch", upstream);

    const body = JSON.stringify({
      metric: "CLS",
      value: 0.02,
      rating: "good",
      page_kind: "invitation",
    });
    const response = await POST(
      request(body, { "x-forwarded-for": "203.0.113.7" }),
    );

    expect(response.status).toBe(204);
    const [url, init] = upstream.mock.calls[0]! as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(/\/public\/rum$/);
    expect(init.body).toBe(body);
    expect((init.headers as Record<string, string>)["x-forwarded-for"]).toBe(
      "203.0.113.7",
    );
  });

  it("refuses an oversized body without calling the API", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const response = await POST(request("x".repeat(2000)));

    expect(response.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("answers 204 when the API is unreachable, so a guest's browser never retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );

    const response = await POST(request("{}"));

    expect(response.status).toBe(204);
  });

  it("passes the API's refusal through, so a malformed report is visible in testing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 400 }))),
    );

    const response = await POST(request("{}"));

    expect(response.status).toBe(400);
  });
});
