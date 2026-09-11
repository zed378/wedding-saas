import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * P0-22 — the contrast floor, computed from the tokens themselves.
 *
 * `docs/UI-UX/08` § Contrast & Accessibility: "All text-background combinations above
 * are validated to reach a minimum contrast ratio of 4.5:1 (normal text) / 3:1 (large
 * text ≥18px bold) per WCAG AA".
 *
 * That claim needs a test, and axe cannot be it: jsdom has no layout engine, so
 * `color-contrast` is disabled in `testing/axe.ts` and every component's axe pass is
 * silent on colour. This file closes that gap by reading the token values out of
 * `tokens.css` and doing the arithmetic.
 *
 * ## The pair list is hand-maintained, and that is the weakness
 *
 * Nothing derives these pairs from the components. A component that introduces a new
 * combination — `text-warning-500` on `bg-surface`, say — is not checked here and will
 * not be checked anywhere, because the browser E2E axe pass only sees the combinations
 * the workbench happens to render.
 *
 * The mitigation is that the workbench renders every component in every state, so the
 * E2E `color-contrast` pass over it does cover what ships. This file is the faster,
 * earlier signal; the workbench is the one that cannot go stale. Both are needed and
 * neither is sufficient.
 */

const TOKENS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "tokens.css"),
  "utf8",
);

/** Every `--color-*: #hex` declaration in the file. */
function colorTokens(): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const pattern = /--(color-[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g;

  for (const match of TOKENS.matchAll(pattern)) {
    map.set(match[1]!, match[2]!.toLowerCase());
  }
  return map;
}

const COLORS = colorTokens();

function resolve(name: string): string {
  const value = COLORS.get(name);
  if (value === undefined) {
    throw new Error(
      `token --${name} is not a literal hex colour in tokens.css. ` +
        `Semantic aliases point at ramp steps; test the ramp step.`,
    );
  }
  return value;
}

/** sRGB channel to linear, per WCAG 2.x relative luminance. */
function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const full =
    hex.length === 4
      ? `#${hex[1]!}${hex[1]!}${hex[2]!}${hex[2]!}${hex[3]!}${hex[3]!}`
      : hex;

  const r = Number.parseInt(full.slice(1, 3), 16);
  const g = Number.parseInt(full.slice(3, 5), 16);
  const b = Number.parseInt(full.slice(5, 7), 16);

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

const WHITE = "#ffffff";

/**
 * Every text-on-background pair a component actually renders.
 *
 * Grouped by the component that uses it, so a failure names something a reader can go
 * and look at rather than two hex codes.
 */
const TEXT_PAIRS: readonly {
  readonly what: string;
  readonly fg: string;
  readonly bg: string;
}[] = [
  // --- body text on the two page surfaces -----------------------------------
  {
    what: "body text on the page",
    fg: resolve("color-neutral-900"),
    bg: resolve("color-neutral-50"),
  },
  { what: "body text on a card", fg: resolve("color-neutral-900"), bg: WHITE },
  {
    what: "muted text on the page",
    fg: resolve("color-neutral-600"),
    bg: resolve("color-neutral-50"),
  },
  { what: "muted text on a card", fg: resolve("color-neutral-600"), bg: WHITE },
  {
    what: "muted text on a sunken panel",
    fg: resolve("color-neutral-600"),
    bg: resolve("color-neutral-100"),
  },

  // --- Button ---------------------------------------------------------------
  { what: "Button primary", fg: WHITE, bg: resolve("color-primary-600") },
  {
    what: "Button primary, hover",
    fg: WHITE,
    bg: resolve("color-primary-700"),
  },
  {
    what: "Button primary, active",
    fg: WHITE,
    bg: resolve("color-primary-800"),
  },
  { what: "Button danger", fg: WHITE, bg: resolve("color-danger-600") },
  { what: "Button danger, hover", fg: WHITE, bg: resolve("color-danger-700") },
  { what: "Button danger, active", fg: WHITE, bg: resolve("color-danger-800") },
  { what: "Button secondary", fg: resolve("color-neutral-900"), bg: WHITE },
  {
    what: "Button secondary, hover",
    fg: resolve("color-neutral-900"),
    bg: resolve("color-neutral-100"),
  },
  {
    what: "Button ghost",
    fg: resolve("color-primary-700"),
    bg: resolve("color-neutral-50"),
  },
  {
    what: "Button ghost, hover",
    fg: resolve("color-primary-700"),
    bg: resolve("color-primary-50"),
  },

  // --- Badge, one row per status in docs/UI-UX/08 ---------------------------
  {
    what: "Badge neutral (draft)",
    fg: resolve("color-neutral-700"),
    bg: resolve("color-neutral-100"),
  },
  {
    what: "Badge warning (pending_payment)",
    fg: resolve("color-warning-800"),
    bg: resolve("color-warning-50"),
  },
  {
    what: "Badge info (paid)",
    fg: resolve("color-info-800"),
    bg: resolve("color-info-50"),
  },
  {
    what: "Badge success (published)",
    fg: resolve("color-success-800"),
    bg: resolve("color-success-50"),
  },
  {
    what: "Badge danger (expired)",
    fg: resolve("color-danger-800"),
    bg: resolve("color-danger-50"),
  },
  {
    what: "Badge premium",
    fg: resolve("color-secondary-900"),
    bg: resolve("color-secondary-100"),
  },
  {
    what: "Badge primary",
    fg: resolve("color-primary-800"),
    bg: resolve("color-primary-50"),
  },

  // --- Toast ----------------------------------------------------------------
  {
    what: "Toast success",
    fg: resolve("color-success-800"),
    bg: resolve("color-success-50"),
  },
  {
    what: "Toast error",
    fg: resolve("color-danger-800"),
    bg: resolve("color-danger-50"),
  },
  {
    what: "Toast warning",
    fg: resolve("color-warning-800"),
    bg: resolve("color-warning-50"),
  },
  {
    what: "Toast info",
    fg: resolve("color-info-800"),
    bg: resolve("color-info-50"),
  },

  // --- Field error and required marker ---------------------------------------
  {
    what: "field error message",
    fg: resolve("color-danger-700"),
    bg: resolve("color-neutral-50"),
  },
  {
    what: "field error message on a card",
    fg: resolve("color-danger-700"),
    bg: WHITE,
  },
  { what: "required asterisk", fg: resolve("color-danger-600"), bg: WHITE },

  // --- Tabs, Avatar, Stepper -------------------------------------------------
  {
    what: "Tabs selected label",
    fg: resolve("color-primary-700"),
    bg: resolve("color-neutral-50"),
  },
  // Dropzone sits on the sunken surface, enabled and disabled. The disabled pair is
  // here because the browser axe pass found the opacity-based version at 4.49:1 --
  // see the comment in Dropzone.tsx.
  {
    what: "Dropzone prompt",
    fg: resolve("color-primary-700"),
    bg: resolve("color-neutral-100"),
  },
  {
    what: "Dropzone prompt, disabled",
    fg: resolve("color-neutral-600"),
    bg: resolve("color-neutral-100"),
  },
  // A disabled input's value is often the reason the user is looking at it. WCAG
  // exempts inactive controls from contrast; this holds the line anyway.
  {
    what: "disabled field value",
    fg: resolve("color-neutral-600"),
    bg: resolve("color-neutral-100"),
  },
  {
    what: "Avatar initials",
    fg: resolve("color-primary-800"),
    bg: resolve("color-primary-100"),
  },
  { what: "Stepper done marker", fg: WHITE, bg: resolve("color-success-700") },
  {
    what: "Stepper current marker",
    fg: WHITE,
    bg: resolve("color-primary-600"),
  },
];

/**
 * Non-text pairs: borders, focus rings and the progress bar.
 *
 * WCAG 2.1 § 1.4.11 sets 3:1 for "user interface components and graphical objects",
 * which is what these are — the boundary of a control has to be distinguishable from
 * what is behind it.
 */
const NON_TEXT_PAIRS: readonly {
  readonly what: string;
  readonly fg: string;
  readonly bg: string;
}[] = [
  {
    what: "focus ring on the page",
    fg: resolve("color-primary-600"),
    bg: resolve("color-neutral-50"),
  },
  { what: "focus ring on a card", fg: resolve("color-primary-600"), bg: WHITE },
  {
    what: "control border on a card",
    fg: resolve("color-neutral-500"),
    bg: WHITE,
  },
  {
    what: "control border on the page",
    fg: resolve("color-neutral-500"),
    bg: resolve("color-neutral-50"),
  },
  {
    what: "invalid control border",
    fg: resolve("color-danger-600"),
    bg: WHITE,
  },
  {
    what: "progress bar fill",
    fg: resolve("color-primary-600"),
    bg: resolve("color-neutral-100"),
  },
];

describe("the contrast maths", () => {
  it("agrees with the WCAG reference values", () => {
    // Without this, a bug in `luminance` would make every assertion below pass.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // A known pair: #767676 on white is the canonical "exactly 4.5:1" grey.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#4f46e5", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#4f46e5"),
      10,
    );
  });

  it("expands three-digit hex", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 5);
  });
});

describe("tokens.css", () => {
  it("carries the five palette values docs/UI-UX/08 fixes", () => {
    // The document names one value per role. Those five are the contract; the rest of
    // each ramp is ours.
    expect(COLORS.get("color-primary-600")).toBe("#4f46e5");
    expect(COLORS.get("color-secondary-500")).toBe("#f59e0b");
    expect(COLORS.get("color-neutral-50")).toBe("#fafafa");
    expect(COLORS.get("color-neutral-900")).toBe("#171717");
    expect(COLORS.get("color-success-600")).toBe("#16a34a");
    expect(COLORS.get("color-warning-500")).toBe("#f59e0b");
    expect(COLORS.get("color-danger-600")).toBe("#dc2626");
    expect(COLORS.get("color-info-500")).toBe("#0ea5e9");
  });

  it("defines the documented 4px spacing base", () => {
    // docs/UI-UX/09 § Base Unit.
    expect(TOKENS).toMatch(/--spacing:\s*0\.25rem/);
  });

  it("defines the radius scale docs/UI-UX/06 names", () => {
    expect(TOKENS).toMatch(/--radius-sm:\s*0\.25rem/); // 4px
    expect(TOKENS).toMatch(/--radius-md:\s*0\.5rem/); // 8px
    expect(TOKENS).toMatch(/--radius-lg:\s*0\.75rem/); // 12px
  });

  it("sets the 44px touch target floor docs/UI-UX/09 requires", () => {
    expect(TOKENS).toMatch(/@utility touch-target[\s\S]*?2\.75rem/);
  });

  it("honours prefers-reduced-motion", () => {
    // docs/UI-UX/17. A product full of transitions is a product that makes some people
    // ill.
    expect(TOKENS).toContain("prefers-reduced-motion");
  });
});

describe("WCAG AA contrast (docs/UI-UX/08)", () => {
  it.each(TEXT_PAIRS.map((p) => [p.what, p] as const))(
    "%s reaches 4.5:1",
    (_what, pair) => {
      const ratio = contrastRatio(pair.fg, pair.bg);
      expect(
        Number(ratio.toFixed(2)),
        `${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(NON_TEXT_PAIRS.map((p) => [p.what, p] as const))(
    "%s reaches 3:1 (WCAG 2.1 § 1.4.11)",
    (_what, pair) => {
      const ratio = contrastRatio(pair.fg, pair.bg);
      expect(
        Number(ratio.toFixed(2)),
        `${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3);
    },
  );
});
