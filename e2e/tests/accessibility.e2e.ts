import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";

/**
 * The accessibility layer. `docs/UI-UX/17` § Testing asks for an "axe-core/Lighthouse
 * accessibility audit in CI for key pages".
 *
 * The key pages do not exist yet — `P0-22` builds them. So this runs against two
 * fixtures, and the second one is the important one: **an axe suite that only ever sees
 * a correct page proves nothing**, because it would report zero violations whether it
 * was working or silently doing nothing at all.
 *
 * When `P0-22` lands, the correct-page test is replaced by the real pages. The negative
 * control stays, because it is what keeps the harness honest.
 */

const fixture = (name: string): string =>
  pathToFileURL(path.join(__dirname, "..", "fixtures", name)).href;

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.describe("accessibility harness", () => {
  test("reports no violations on a correct page", async ({ page }) => {
    await page.goto(fixture("accessible-page.html"));

    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();

    expect(
      results.violations.map((v) => `${v.id}: ${v.help}`),
      "the accessible fixture should have no violations",
    ).toEqual([]);
  });

  test("reports violations on a broken page — the negative control", async ({
    page,
  }) => {
    // Without this, the test above would pass on a harness that was doing nothing.
    await page.goto(fixture("inaccessible-page.html"));

    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    const ids = results.violations.map((v) => v.id);

    expect(ids.length).toBeGreaterThan(0);
    // Named rather than counted. A count would pass if axe found some entirely
    // different problem, which would mean the fixture had drifted from what it claims
    // to test.
    expect(ids).toContain("image-alt");
    expect(ids).toContain("label");
  });
});
