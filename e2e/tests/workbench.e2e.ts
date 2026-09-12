import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * P0-22 — the browser accessibility pass over the design system.
 *
 * ## Why this exists when `@wi/ui` already runs axe
 *
 * The jsdom pass in `@wi/ui` has **`color-contrast` disabled**, because jsdom has no
 * layout engine: every element is zero-sized with no computed colour, so the rule cannot
 * run at all. `docs/UI-UX/08` § Contrast & Accessibility requires 4.5:1 on every
 * text-background pair, and `packages/ui/src/tokens.spec.ts` checks that arithmetically
 * from the token values.
 *
 * Neither of those sees what a browser actually paints. A component that applies the
 * wrong token, or two tokens whose combination nobody listed, passes both and fails
 * here. This is the only place the real pixels are audited.
 *
 * It also covers the four `<dialog>` behaviours the jsdom polyfill explicitly cannot
 * prove — focus trapping, page inertness, Escape, and top-layer rendering.
 *
 * ## Running it
 *
 *   pnpm --filter @wi/web-app build && pnpm --filter @wi/web-app start
 *   E2E_WEB_APP_URL=http://localhost:3100 pnpm --filter @wi/e2e test:e2e
 */

const WEB_APP = process.env["E2E_WEB_APP_URL"] ?? "http://localhost:3100";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Every story on the page.
 *
 * Read from the DOM rather than hard-coded: a component added to the workbench is
 * covered automatically, and a list here would be a fourth hand-maintained inventory in
 * a repository that has already been bitten by three.
 */
async function storyNames(page: Page): Promise<string[]> {
  return page.$$eval("[data-story]", (nodes) =>
    nodes.map((n) => n.getAttribute("data-story") ?? ""),
  );
}

test.describe("component workbench", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${WEB_APP}/workbench`);
    await expect(
      page.getByRole("heading", { name: "Workbench", level: 1 }),
    ).toBeVisible();
  });

  test("renders a story for every component in the library", async ({
    page,
  }) => {
    // The negative control for the per-story audit below: if the page rendered nothing,
    // `storyNames` would return an empty array and every axe assertion would pass
    // vacuously.
    const names = await storyNames(page);

    expect(names.length).toBeGreaterThanOrEqual(11);
    for (const required of [
      "button",
      "fields",
      "dropzone",
      "badge",
      "card",
      "tabs",
      "table",
      "stepper",
      "skeleton",
      "avatar",
      "overlays",
    ]) {
      expect(names, `no story for ${required}`).toContain(required);
    }
  });

  test("has no accessibility violations anywhere on the page", async ({
    page,
  }) => {
    // The whole-page pass catches what per-story passes cannot: a duplicate id across
    // two components, a heading level that skips, a landmark nested inside another.
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();

    expect(
      results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`),
    ).toEqual([]);
  });

  test("every story passes axe on its own, colour contrast included", async ({
    page,
  }) => {
    // Per story, so a violation names the component rather than "the page". The failure
    // message is the whole value here -- "color-contrast on [data-story=badge]" is
    // actionable; "color-contrast somewhere" is an afternoon.
    const names = await storyNames(page);
    const failures: string[] = [];

    for (const name of names) {
      const results = await new AxeBuilder({ page })
        .include(`[data-story="${name}"]`)
        .withTags(WCAG)
        .analyze();

      for (const violation of results.violations) {
        failures.push(`${name} → ${violation.id}: ${violation.help}`);
      }
    }

    expect(failures).toEqual([]);
  });

  test("colour contrast is actually being checked, not silently skipped", async ({
    page,
  }) => {
    // The negative control that matters most. axe reports zero violations both when a
    // page is perfect and when a rule never ran -- and `color-contrast` not running is
    // exactly the state the jsdom suite is in. Injecting a deliberately unreadable
    // element proves the rule is live in this environment.
    await page.evaluate(() => {
      const bad = document.createElement("p");
      bad.id = "contrast-control";
      bad.textContent = "Teks ini sengaja tidak terbaca";
      bad.style.color = "#fafafa";
      bad.style.backgroundColor = "#ffffff";
      bad.style.fontSize = "14px";
      document.body.append(bad);
    });

    const results = await new AxeBuilder({ page })
      .include("#contrast-control")
      .withTags(WCAG)
      .analyze();

    expect(results.violations.map((v) => v.id)).toContain("color-contrast");
  });
});

test.describe("the modal behaviours jsdom cannot prove", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${WEB_APP}/workbench`);
    await page.getByRole("button", { name: "Buka konfirmasi" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("traps focus inside the dialog", async ({ page }) => {
    // The first of the four reasons Modal uses the platform <dialog>. The jsdom
    // polyfill in @wi/ui only restores the `open` attribute; nothing there can say
    // whether Tab escapes.
    //
    // The assertion is "focus never reaches a control on the page behind", NOT "focus
    // is always inside the dialog". Those differ, and the first version of this test
    // asserted the second and failed on a correct implementation: tabbing past the last
    // element in the top layer hands focus to the BROWSER's own chrome, at which point
    // `document.activeElement` is `<body>`. That is the browser working as designed,
    // and a test that calls it a failure is a test that would push someone towards a
    // hand-rolled focus trap -- which is the thing `<dialog>` exists to avoid.
    const escapes: string[] = [];

    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");

      const where = await page.evaluate(() => {
        const active = document.activeElement;
        if (active === null) return "none";
        if (active === document.body || active === document.documentElement) {
          // Focus is in the browser UI, not in the page.
          return "chrome";
        }
        return active.closest("dialog") === null ? "page" : "dialog";
      });

      if (where === "page") escapes.push(`tab ${i + 1}`);
    }

    expect(escapes, "focus reached the page behind the dialog").toEqual([]);
  });

  test("makes the page behind it inert", async ({ page }) => {
    // Not merely covered -- actually unreachable. A backdrop that only looks opaque
    // leaves the page behind operable by keyboard and readable by a screen reader.
    const behind = page.getByRole("button", { name: "Buka formulir" });

    await behind.evaluate((node) => (node as HTMLButtonElement).focus());
    const focused = await behind.evaluate(
      (node) => document.activeElement === node,
    );
    expect(focused).toBe(false);
  });

  test("closes on Escape", async ({ page }) => {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("has no accessibility violations while open", async ({ page }) => {
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

test.describe("the app shell", () => {
  test("offers a skip link as the first focusable element", async ({
    page,
  }) => {
    // docs/UI-UX/17. Without it a keyboard user tabs through the whole navigation on
    // every page before reaching anything they came for.
    await page.goto(WEB_APP);
    await page.keyboard.press("Tab");

    const focused = page.locator(":focus");
    await expect(focused).toHaveText("Lewati ke konten utama");
    await expect(focused).toHaveAttribute("href", "#main");
  });

  /**
   * DF-11 — the editor's three-column layout, executed for the first time.
   *
   * `P1-22` shipped the editor shell noting its desktop layout was untested, and said
   * why: **jsdom evaluates no media queries**, so every editor component test asserts the
   * mobile arrangement and the `md:` three-column layout had never been executed by
   * anything. `P1-25` inherited the gap and could not discharge it, because the wizard
   * rendered `templates={[]}` until `P2-01` and no user could reach an editor route.
   *
   * A real browser is the only thing that can answer this, and the workbench is the only
   * page the browser suite already opens. What is asserted is the CSS question DF-11
   * actually asks — are three panels visible at once above the breakpoint, and do they
   * collapse below it.
   */
  test("shows the editor's three panels at once on a desktop viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${WEB_APP}/workbench`);

    const layout = page.locator("[data-editor-layout]");
    await expect(layout.locator("[data-panel='sections']")).toBeVisible();
    await expect(layout.locator("[data-panel='preview']")).toBeVisible();
    await expect(layout.locator("[data-panel='properties']")).toBeVisible();

    // Side by side rather than merely all present: three stacked panels would also pass
    // three visibility checks, and stacking is exactly the mobile arrangement this test
    // exists to distinguish from.
    const boxes = await Promise.all(
      ["sections", "preview", "properties"].map((panel) =>
        layout.locator(`[data-panel='${panel}']`).boundingBox(),
      ),
    );

    expect(boxes.every((box) => box !== null)).toBe(true);
    const lefts = boxes.map((box) => box!.x);
    expect(lefts[0]!).toBeLessThan(lefts[1]!);
    expect(lefts[1]!).toBeLessThan(lefts[2]!);
  });

  test("collapses those panels below the breakpoint", async ({ page }) => {
    // The other half: the mobile arrangement every jsdom test has been asserting all
    // along, confirmed in a browser that actually evaluates the media query.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${WEB_APP}/workbench`);

    const layout = page.locator("[data-editor-layout]");

    // Attached first, hidden second. `toBeHidden` also passes for an element that is not
    // in the DOM at all -- so on its own it would keep passing if the story were deleted,
    // renamed, or (as happened while writing this) if the test navigated to the wrong
    // page. That is a vacuous pass, and this is the two lines that stop it.
    await expect(layout).toBeAttached();
    for (const panel of ["sections", "preview", "properties"]) {
      const locator = layout.locator(`[data-panel='${panel}']`);
      await expect(locator).toBeAttached();
      await expect(locator).toBeHidden();
    }
  });

  test("declares the page language, so a screen reader pronounces it", async ({
    page,
  }) => {
    // An Indonesian interface announced with English phonemes is close to unusable.
    await page.goto(WEB_APP);
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
  });

  test("delivers the security headers it configures", async ({ page }) => {
    // The P0-13 lesson, applied to the frontend: configured is not delivered.
    const response = await page.goto(WEB_APP);
    const headers = response?.headers() ?? {};

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]?.toLowerCase()).toBe("deny");
    expect(headers["referrer-policy"]).toBe("no-referrer");
  });
});
