import { afterEach, describe, expect, it, vi } from "vitest";

import { isInAppBrowser, getBrowserName } from "../src/lib/in-app-browser";

/**
 * P3-14 — in-app browser detection.
 *
 * The detection is heuristic and best-effort. The tests here cover the UAs known to cause
 * issues with Midtrans Snap.js in Indonesia (Facebook/WhatsApp and Instagram).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function setUserAgent(ua: string) {
  vi.stubGlobal("navigator", { userAgent: ua });
}

describe("isInAppBrowser", () => {
  it("returns false for a normal Chrome user agent", () => {
    setUserAgent(
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
    );
    expect(isInAppBrowser()).toBe(false);
  });

  it("returns false for Safari", () => {
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    );
    expect(isInAppBrowser()).toBe(false);
  });

  it("detects Facebook in-app browser (FBAN)", () => {
    setUserAgent(
      "Mozilla/5.0 (Linux; Android 12; SM-G973U) AppleWebKit/537.36 " +
        "FBAN/FB4A;FBAV/431.0.0.35.119",
    );
    expect(isInAppBrowser()).toBe(true);
  });

  it("detects Facebook in-app browser (FBAV)", () => {
    setUserAgent("Mozilla/5.0 FBAV/431.0.0.35.119");
    expect(isInAppBrowser()).toBe(true);
  });

  it("detects Instagram in-app browser", () => {
    setUserAgent(
      "Mozilla/5.0 (Linux; Android 12; SM-G973U) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 Instagram/304.0.0.35.119",
    );
    expect(isInAppBrowser()).toBe(true);
  });

  it("detects LINE in-app browser", () => {
    setUserAgent(
      "Mozilla/5.0 (Linux; Android 12; SM-A325F) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 Line/13.6.0",
    );
    expect(isInAppBrowser()).toBe(true);
  });

  it("returns false when navigator is undefined (SSR)", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isInAppBrowser()).toBe(false);
  });
});

describe("getBrowserName", () => {
  it("returns undefined for a normal browser", () => {
    setUserAgent("Mozilla/5.0 Chrome/119.0.0.0");
    expect(getBrowserName()).toBeUndefined();
  });

  it("returns 'Instagram' for Instagram UA", () => {
    setUserAgent("Mozilla/5.0 Instagram/304.0.0.35.119");
    expect(getBrowserName()).toBe("Instagram");
  });

  it("returns 'Facebook' for FBAN UA", () => {
    setUserAgent("Mozilla/5.0 FBAN/FB4A;FBAV/431.0.0.35.119");
    expect(getBrowserName()).toBe("Facebook");
  });

  it("returns 'LINE' for Line UA", () => {
    setUserAgent("Mozilla/5.0 Line/13.6.0");
    expect(getBrowserName()).toBe("LINE");
  });

  it("returns undefined when navigator is undefined (SSR)", () => {
    vi.stubGlobal("navigator", undefined);
    expect(getBrowserName()).toBeUndefined();
  });
});
