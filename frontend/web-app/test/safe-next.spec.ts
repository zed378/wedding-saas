import { describe, expect, it } from "vitest";

import {
  DEFAULT_AFTER_LOGIN,
  isAuthPath,
  loginUrlFor,
  safeNext,
} from "../src/lib/safe-next";

/**
 * P1-20 — the open-redirect guard.
 *
 * The destination after login arrives in a query parameter, which means anybody can choose
 * it. `https://app.vizunicum.my.id/login?next=https://evil.test/` sends a victim to a
 * convincing phishing page one click after they typed their real password, and a login page
 * is the single worst place in a product to have an open redirect.
 *
 * So this file is mostly a list of the ways a URL can pretend to be a path.
 */

describe("safeNext", () => {
  it("keeps a same-origin path", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/editor/abc-123")).toBe("/editor/abc-123");
  });

  it("keeps the query string, because the template is in it", () => {
    // `docs/UI-UX/11` § "Use This Template": a user who picked a template while logged out
    // must land back in that flow. The template is a query parameter, so dropping the query
    // strands them one step short of what they came to do.
    expect(safeNext("/dashboard/new?template=elegant-rose")).toBe(
      "/dashboard/new?template=elegant-rose",
    );
  });

  it.each([
    ["an absolute https URL", "https://evil.test/phish"],
    ["an absolute http URL", "http://evil.test/phish"],
    ["a protocol-relative URL", "//evil.test/phish"],
    ["a backslash after the slash", "/\\evil.test"],
    ["a javascript: scheme", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,<script>alert(1)</script>"],
    ["a scheme hidden in the first segment", "/https://evil.test"],
    ["a relative path", "dashboard"],
    ["an empty string", ""],
    ["a tab before the scheme", "/\tjavascript:alert(1)"],
    ["a newline", "/foo\n/bar"],
    ["a space", "/foo bar"],
  ])("refuses %s", (_name, raw) => {
    expect(safeNext(raw)).toBe(DEFAULT_AFTER_LOGIN);
  });

  it.each([null, undefined])("falls back for %s", (raw) => {
    expect(safeNext(raw)).toBe(DEFAULT_AFTER_LOGIN);
  });

  it("refuses an auth page, so login does not loop", () => {
    // The guard would bounce an authenticated user straight back off `/login`, and the pair
    // would look to the user like a login that did not work.
    expect(safeNext("/login")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNext("/register?next=%2Fdashboard")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNext("/reset-password?token=abc")).toBe(DEFAULT_AFTER_LOGIN);
  });

  it("honours an explicit fallback", () => {
    expect(safeNext("https://evil.test", "/templates")).toBe("/templates");
  });
});

describe("isAuthPath", () => {
  it.each([
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
  ])("recognises %s", (path) => {
    expect(isAuthPath(path)).toBe(true);
  });

  it("ignores the query when deciding", () => {
    expect(isAuthPath("/login?next=%2Fdashboard")).toBe(true);
  });

  it("does not match a path that merely starts with the same letters", () => {
    // `/registerships` is not `/register`. A `startsWith` without the boundary check would
    // exclude a legitimate route from ever being a post-login destination.
    expect(isAuthPath("/registerships")).toBe(false);
    expect(isAuthPath("/logins")).toBe(false);
  });
});

describe("loginUrlFor", () => {
  it("carries the intended path", () => {
    expect(loginUrlFor("/dashboard")).toBe("/login?next=%2Fdashboard");
  });

  it("carries the query string with it", () => {
    expect(loginUrlFor("/dashboard/new", "?template=elegant-rose")).toBe(
      "/login?next=%2Fdashboard%2Fnew%3Ftemplate%3Delegant-rose",
    );
  });

  it("round-trips through safeNext", () => {
    // The two halves have to agree: the guard writes the parameter and the login page reads
    // it. A mismatch would fail silently by sending everybody to the dashboard.
    const url = loginUrlFor("/dashboard/new", "?template=elegant-rose");
    const raw = new URLSearchParams(url.split("?")[1]).get("next");

    expect(safeNext(raw)).toBe("/dashboard/new?template=elegant-rose");
  });

  it("does not carry an auth page into itself", () => {
    expect(loginUrlFor("/login", "?next=%2Fdashboard")).toBe("/login");
  });
});
