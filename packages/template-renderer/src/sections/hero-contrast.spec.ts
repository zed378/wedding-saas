import { describe, expect, it } from "vitest";

import { SECTION_STYLES } from "./styles.js";

/**
 * `P2-13` — text contrast over a photograph, computed.
 *
 * `P2-03`'s accessibility DoD had a half jsdom cannot check: axe's `color-contrast` rule does
 * not run without a layout engine, and even in a browser it reports text over an image as
 * "incomplete" rather than measuring it. `P2-03` handed the question to `P2-13`.
 *
 * It does not need a browser. The hero's legibility is guaranteed by one CSS value — the
 * scrim's opacity — and the worst case is knowable in advance: a pure white photograph. So
 * this blends the scrim's lightest stop over white, exactly as the browser composites it, and
 * requires WCAG AA against the text drawn on top.
 *
 * It found a real defect on its first run. The scrim was 45% → 65%, commented as clearing
 * 4.5:1 "against any photograph". Over white it clears about 3.4:1.
 */

/** WCAG relative luminance of an sRGB channel in 0..1. */
function linear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function contrast(foreground: number, background: number): number {
  const [light, dark] =
    foreground > background
      ? [foreground, background]
      : [background, foreground];
  return (light + 0.05) / (dark + 0.05);
}

/** The scrim's gradient stops, as black alphas in 0..1, read from the stylesheet itself. */
function scrimAlphas(): number[] {
  const rule = /\.wi-hero-scrim\s*\{([^}]*)\}/.exec(SECTION_STYLES)?.[1] ?? "";
  return [...rule.matchAll(/rgb\(\s*0\s+0\s+0\s*\/\s*([0-9.]+)%\s*\)/g)].map(
    (match) => Number(match[1]) / 100,
  );
}

/** A white photo pixel under a black scrim of this alpha, as a luminance. */
function scrimOverWhite(alpha: number): number {
  return linear(1 - alpha);
}

describe("the hero scrim guarantees WCAG AA over any photograph", () => {
  it("is read from the real stylesheet", () => {
    // Without this, a renamed class makes every assertion below pass against nothing.
    expect(scrimAlphas().length).toBeGreaterThanOrEqual(2);
  });

  it("gives the couple's names at least 4.5:1 at the scrim's lightest point", () => {
    const lightest = Math.min(...scrimAlphas());
    const background = scrimOverWhite(lightest);

    // White text. The names are large enough for 3:1, but the same scrim sits behind the
    // normal-size date and greeting, so the requirement is the stricter one.
    expect(contrast(1, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("gives the date at 92% opacity at least 4.5:1 at the scrim's lightest point", () => {
    // `.wi-hero-date` is white at `opacity: 0.92`, composited over the scrimmed photo.
    const lightest = Math.min(...scrimAlphas());
    const backgroundChannel = 1 - lightest;
    const textChannel = 0.92 * 1 + 0.08 * backgroundChannel;

    expect(
      contrast(linear(textChannel), linear(backgroundChannel)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the date's opacity where the calculation assumed it", () => {
    // The previous test is only true for the opacity it modelled. If the stylesheet makes
    // the date fainter, this fails and the model has to be revisited rather than trusted.
    const rule = /\.wi-hero-date\s*\{([^}]*)\}/.exec(SECTION_STYLES)?.[1] ?? "";
    const opacity = Number(/opacity:\s*([0-9.]+)/.exec(rule)?.[1] ?? "1");

    expect(opacity).toBeGreaterThanOrEqual(0.92);
  });
});

/**
 * `P2-14` — the hero with no cover photo.
 *
 * The scrim only exists behind a photo, so a couple who had not uploaded one yet got white
 * text on the theme's light background — found in a full-stack E2E screenshot, where "Kami
 * akan menikah" was nearly invisible. The plain hero draws with the theme's own colours; this
 * measures them for the reference theme, whose values are data rather than constants here.
 */
describe("the hero without a photo is legible on the reference theme", () => {
  const hex = (value: string): number[] =>
    [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const luminanceOf = (value: string): number => {
    const [r, g, b] = hex(value).map(linear) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  it("switches the text off white when there is no scrim", () => {
    expect(SECTION_STYLES).toMatch(
      /\.wi-hero-plain \.wi-hero-names\s*\{[^}]*color:\s*var\(--color-primary\)/,
    );
    expect(SECTION_STYLES).toMatch(
      /\.wi-hero-plain \.wi-hero-date\s*\{[^}]*color:\s*var\(--color-text\)/,
    );
  });

  it("clears 4.5:1 for the date and 3:1 for the large names", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    // `process.cwd()` is this package; `import.meta.url` is not a file URL under Vitest (P2-08).
    const reference = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "../../backend/api/src/infra/db/seed-data/reference-template.json",
        ),
        "utf8",
      ),
    ) as { theme: { colors: Record<string, string> } };
    const { primary, secondary, text } = reference.theme.colors as {
      primary: string;
      secondary: string;
      text: string;
    };

    expect(
      contrast(luminanceOf(text), luminanceOf(secondary)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(luminanceOf(primary), luminanceOf(secondary)),
    ).toBeGreaterThanOrEqual(3);
  });
});
