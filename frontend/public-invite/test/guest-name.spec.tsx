import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { GuestGreeting } from "../src/components/GuestGreeting";
import { cleanGuestName, readGuestName } from "../src/lib/guest-name";

/**
 * `P2-10` step 2 — `?to=Name`.
 *
 * The card's DoD: *"A `?to=` value containing markup renders as text, never as HTML"* and
 * *"personalization never affects the server response or the cache key"*.
 *
 * The second of those is asserted in `initial-html.ssr.ts`, where the server's bytes can
 * actually be read. This file covers the first, plus the shapes that are harmful even
 * after escaping — which is the part React does not do for you.
 */

afterEach(() => {
  cleanup();
});

describe("reading the parameter", () => {
  it("takes the name", () => {
    expect(readGuestName("?to=Andi%20Pratama")).toBe("Andi Pratama");
  });

  it("is absent when there is no parameter", () => {
    expect(readGuestName("")).toBeUndefined();
    expect(readGuestName("?utm_source=wa")).toBeUndefined();
  });

  it("is absent rather than empty for a blank value", () => {
    // A greeting addressed to nobody looks like the couple forgot to fill something in.
    expect(readGuestName("?to=")).toBeUndefined();
    expect(readGuestName("?to=%20%20")).toBeUndefined();
  });

  it("survives a malformed query string", () => {
    // This runs on whatever a forwarded link contains, and a throw would blank the page.
    expect(() => readGuestName("?to=%E0%A4%A")).not.toThrow();
  });

  it("ignores other parameters", () => {
    expect(readGuestName("?utm_source=wa&to=Dewi&ref=x")).toBe("Dewi");
  });
});

describe("cleaning the value", () => {
  it("collapses a multi-line value to one line", () => {
    // Encoded newlines in a URL would otherwise push the invitation off the screen.
    expect(cleanGuestName("Andi\n\n\nPratama")).toBe("Andi Pratama");
    expect(cleanGuestName("Andi\t \tPratama")).toBe("Andi Pratama");
  });

  it("strips a right-to-left override", () => {
    // The attack that survives HTML escaping completely: U+202E reverses the direction of
    // everything after it, so a crafted name can make the surrounding page read backwards.
    // Nothing about it is markup, so nothing else in the stack would catch it.
    const reversed = `Andi‮Pratama`;

    expect(cleanGuestName(reversed)).toBe("AndiPratama");
    expect(cleanGuestName(reversed)).not.toContain("‮");
  });

  it.each([
    ["a zero-width space", "​"],
    ["a left-to-right mark", "‎"],
    ["a word joiner", "⁠"],
    ["a byte-order mark", "﻿"],
  ])("strips %s", (_label, character) => {
    expect(cleanGuestName(`An${character}di`)).toBe("Andi");
  });

  it("truncates a very long value rather than rejecting it", () => {
    const long = "A".repeat(200);
    const cleaned = cleanGuestName(long);

    // Truncated, not dropped: somebody with a genuinely long name should still be greeted.
    expect(cleaned).toBeDefined();
    expect(cleaned!.length).toBeLessThanOrEqual(61);
    expect(cleaned!.endsWith("…")).toBe(true);
  });

  it("keeps the characters Indonesian names actually contain", () => {
    for (const name of [
      "Bapak H. Ahmad Sudirman",
      "Ibu Ratna Sari, S.Pd.",
      "Andi & Sarah",
      "Nguyễn Thị Hoa",
      "O'Brien",
    ]) {
      expect(cleanGuestName(name), name).toBe(name);
    }
  });
});

describe("the greeting on the page", () => {
  const withSearch = (search: string) => {
    window.history.replaceState({}, "", `/andi-sarah${search}`);
  };

  it("renders the name", () => {
    withSearch("?to=Dewi%20Lestari");
    render(<GuestGreeting />);

    expect(screen.getByText("Dewi Lestari")).toBeInTheDocument();
  });

  it("renders nothing at all when there is no parameter", () => {
    // No placeholder and no reserved space: a box that says nothing is worse than no box,
    // and every guest who opens the bare address is in this case.
    withSearch("");
    const { container } = render(<GuestGreeting />);

    expect(container.querySelector("[data-guest-greeting]")).toBeNull();
  });

  it("renders markup as text, never as HTML", () => {
    // The DoD item. React escapes children, so this is really a regression test on that
    // property — which is exactly the sort of thing that gets broken by somebody reaching
    // for `dangerouslySetInnerHTML` to make a name bold.
    const payload = '<img src=x onerror="alert(1)">';
    withSearch(`?to=${encodeURIComponent(payload)}`);

    const { container } = render(<GuestGreeting />);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(payload)).toBeInTheDocument();
  });

  it("renders a script tag as text", () => {
    const payload = "</strong><script>alert(1)</script>";
    withSearch(`?to=${encodeURIComponent(payload)}`);

    const { container } = render(<GuestGreeting />);

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("alert(1)");
  });
});
