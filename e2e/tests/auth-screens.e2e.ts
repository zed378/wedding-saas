import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * P1-20 DoD item 4 — the auth screens audited in a real browser.
 *
 * The jsdom pass in `frontend/web-app/test/auth-screens.spec.tsx` runs axe on every one of
 * these screens already, and it cannot run one rule: **`color-contrast`**. jsdom has no
 * layout engine, so every element has zero size and no computed colour, and the rule is
 * disabled there. `docs/UI-UX/08` requires 4.5:1 on every text-background pair, and this is
 * the only place in the suite that can check it against rendered pixels.
 *
 * So this file is not a duplicate of the component tests. It is the half of the accessibility
 * requirement they are structurally unable to cover.
 *
 *   pnpm --filter @wi/web-app build && pnpm --filter @wi/web-app start
 *   E2E_WEB_APP_URL=http://localhost:3100 pnpm --filter @wi/e2e test:e2e auth-screens
 */

const BASE = process.env["E2E_WEB_APP_URL"];

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Every auth route, with the query each needs to render its main state. */
const SCREENS: readonly { readonly name: string; readonly path: string }[] = [
  { name: "login", path: "/login" },
  { name: "login with a return path", path: "/login?next=%2Fdashboard" },
  { name: "register", path: "/register" },
  { name: "forgot password", path: "/forgot-password" },
  { name: "reset password", path: "/reset-password?token=sample-token" },
  // No token: the screen that offers a new link rather than a form that cannot work.
  { name: "reset password without a token", path: "/reset-password" },
  { name: "verify email without a token", path: "/verify-email" },
];

test.describe("auth screens", () => {
  test.skip(
    BASE === undefined,
    "Set E2E_WEB_APP_URL to the running web app. The suite audits rendered pixels, so it cannot fall back to a fixture.",
  );

  for (const screen of SCREENS) {
    test(`${screen.name} has no accessibility violations`, async ({ page }) => {
      await page.goto(`${BASE}${screen.path}`);
      // The heading is the signal that the client component has hydrated; auditing before
      // that would audit the Suspense fallback, which is empty and trivially passes.
      await page.waitForSelector("h1");

      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();

      expect(
        results.violations.map((v) => `${v.id}: ${v.help}`),
        `${screen.name} should have no violations`,
      ).toEqual([]);
    });
  }

  test("colour contrast is actually checked here", async ({ page }) => {
    // The reason this file exists. If `color-contrast` is not among the rules that ran, the
    // browser pass is testing the same subset jsdom already covers and the gap `docs/UI-UX/08`
    // cares about is unguarded — while every test above still reports green.
    await page.goto(`${BASE}/login`);
    await page.waitForSelector("h1");

    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    const ran = [...results.passes, ...results.violations].map((r) => r.id);

    expect(ran).toContain("color-contrast");
  });

  test("the skip link is the first thing a keyboard reaches", async ({
    page,
  }) => {
    // `docs/UI-UX/17`: a keyboard user must reach the content without tabbing through the
    // navigation on every page. The link is visually hidden until focused, so the only way
    // to know it works is to focus it.
    await page.goto(`${BASE}/login`);
    await page.waitForSelector("h1");

    await page.keyboard.press("Tab");

    const focused = page.locator(":focus");
    await expect(focused).toHaveText(/lewati ke konten utama/i);
    await expect(focused).toBeVisible();
  });

  test("a login page carries no token into browser storage", async ({
    page,
  }) => {
    // The component test asserts this after a real login against a stubbed API. This asserts
    // the weaker but browser-level version: simply loading the page — which runs the session
    // restore — writes nothing persistent. `docs/FRONTEND/02`.
    await page.goto(`${BASE}/login`);
    await page.waitForSelector("h1");

    const stored = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));

    expect(Object.keys(stored.local)).toEqual([]);
    expect(Object.keys(stored.session)).toEqual([]);
  });
});

/**
 * P1-21 DoD item 4 — the dashboard at 360px.
 *
 * "Usable at 360px" is a statement about **layout**, and layout is the one thing jsdom has
 * none of. The check that matters is not a screenshot: it is that nothing forces the document
 * wider than the viewport, because a page that scrolls sideways on a phone hides its own
 * actions off the right edge and `docs/UI-UX/15` is specifically about this.
 *
 * The dashboard is behind the route guard, so an unauthenticated visit lands on `/login`.
 * That is the page this measures — which is the honest scope until `P1-25`'s suite can
 * authenticate. The list's own responsive behaviour is covered by its component test's grid
 * classes and by this same check once a session exists.
 */
test.describe("mobile layout (docs/UI-UX/15)", () => {
  test.skip(BASE === undefined, "Set E2E_WEB_APP_URL to the running web app.");

  for (const path of ["/login", "/register", "/dashboard"]) {
    test(`${path} does not scroll sideways at 360px`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.goto(`${BASE}${path}`);
      await page.waitForSelector("h1, p[role='status']");

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      // One pixel of tolerance for sub-pixel rounding; anything more is a real overflow.
      expect(
        overflow.scrollWidth - overflow.clientWidth,
        `${JSON.stringify(overflow)}`,
      ).toBeLessThanOrEqual(1);
    });
  }

  test("every tap target on the login form is at least 44px tall", async ({
    page,
  }) => {
    // `docs/UI-UX/15` and WCAG 2.5.5. A 28px button is reachable with a mouse and a
    // coin-toss with a thumb.
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`${BASE}/login`);
    await page.waitForSelector("h1");

    const heights = await page
      .locator("main button, main input")
      .evaluateAll((nodes) =>
        nodes.map((n) => Math.round(n.getBoundingClientRect().height)),
      );

    expect(heights.length).toBeGreaterThan(0);
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
  });
});
