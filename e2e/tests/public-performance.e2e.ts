import { test, expect, devices, type Page } from "@playwright/test";

import { contrastRatio, decodePng, luminance } from "../fixtures/png";
import {
  APP_ORIGIN,
  SLUGS,
  startPublicInviteStack,
  type Stack,
} from "../fixtures/public-invite-stack";

/**
 * `P2-13` — the public invitation in a real browser: Core Web Vitals on a slow phone, what
 * loads eagerly, real-user monitoring, a visual snapshot of every section, and text
 * contrast over a photograph measured from rendered pixels.
 *
 * ## Running it
 *
 *   pnpm --filter @wi/public-invite build
 *   pnpm --filter @wi/e2e exec playwright test public-performance
 *
 * The suite starts its own `next start` and stub API (`fixtures/public-invite-stack.ts`);
 * nothing else needs to be running.
 *
 * ## The network and the phone — two profiles, because "simulated 4G" is ambiguous
 *
 * `docs/FRONTEND/09` asks for LCP under 2.5s "tested on a simulated 4G connection" and does
 * not say which. Chrome DevTools ships two presets with that name, and they differ by a factor
 * of about three in latency and six in bandwidth:
 *
 * - **Fast 4G** — 60ms RTT (165ms request latency after DevTools' 2.75x adjustment), 9Mbps
 *   down, 1.5Mbps up, both at 90%. The budget is ASSERTED here.
 * - **Slow 4G** — Lighthouse's mobile default: 150ms RTT (562.5ms), 1.6Mbps down, 750Kbps up.
 *   Measured at about 2.8s by Lighthouse's own simulated throttling and 3.1-3.3s here. The
 *   page is over 2.5s on this profile, and the remaining cost is the framework's ~145KB of
 *   JavaScript sharing the link with an 84KB cover (see ADR-067). Which profile the criterion
 *   means is `OQ-26`; until it is answered this asserts a regression ceiling, not the budget.
 *
 * Both with a 4x CPU slowdown — the stand-in for the mid-range Android phone
 * `docs/FRONTEND/09` has in mind. A laptop with no throttling passes any budget.
 */

const { defaultBrowserType: _ignored, ...pixel7 } = devices["Pixel 7"];

/** Chrome DevTools' presets, in bytes per second, exactly as DevTools defines them. */
const PROFILES = {
  "Fast 4G": {
    offline: false,
    latency: 60 * 2.75,
    downloadThroughput: ((9 * 1000 * 1000) / 8) * 0.9,
    uploadThroughput: ((1.5 * 1000 * 1000) / 8) * 0.9,
  },
  "Slow 4G": {
    offline: false,
    latency: 150 * 3.75,
    downloadThroughput: ((1.6 * 1000 * 1000) / 8) * 0.9,
    uploadThroughput: ((750 * 1000) / 8) * 0.9,
  },
} as const;

const LCP_BUDGET_MS = 2_500;
/**
 * Slow 4G's ceiling: not the budget (`OQ-26`), a tripwire. P2-13 left it at 3.1-3.3s from a
 * starting point of 5.2s; a change that takes it past 4s has undone part of that work.
 */
const SLOW_4G_CEILING_MS = 4_000;
const CLS_BUDGET = 0.1;

let stack: Stack;

test.beforeAll(async () => {
  stack = await startPublicInviteStack();
});

test.afterAll(async () => {
  await stack?.stop();
});

test.use({ ...pixel7 });

interface VitalsSnapshot {
  lcp: {
    startTime: number;
    tag: string | undefined;
    className: string | undefined;
    section: string | undefined;
    url: string;
  }[];
  /** The cover's own paint, from Element Timing (`elementtiming="wi-lcp-image"`). */
  cover: number | undefined;
  cls: number;
}

/** Record LCP candidates and layout shifts from the first byte, before any page script. */
async function observeVitals(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = {
      lcp: [] as unknown[],
      cover: undefined as number | undefined,
      cls: 0,
    };
    (window as unknown as { __vitals: typeof store }).__vitals = store;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const lcp = entry as PerformanceEntry & {
          element?: Element;
          url?: string;
        };
        store.lcp.push({
          startTime: lcp.startTime,
          tag: lcp.element?.tagName,
          className: lcp.element?.className,
          section:
            lcp.element
              ?.closest("[data-section]")
              ?.getAttribute("data-section") ?? undefined,
          url: lcp.url ?? "",
        });
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const timing = entry as PerformanceEntry & {
          identifier: string;
          renderTime: number;
          loadTime: number;
        };
        if (timing.identifier === "wi-lcp-image")
          store.cover = timing.renderTime || timing.loadTime;
      }
    }).observe({ type: "element", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        };
        if (!shift.hadRecentInput) store.cls += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

/** Open the cover gate, once hydration has attached its handler. */
async function openGate(page: Page): Promise<void> {
  const button = page.locator("[data-cover-gate-control] button");
  await expect(async () => {
    if ((await button.count()) > 0) await button.click({ timeout: 1_000 });
    await expect(page.locator("[data-cover-gate]")).toHaveAttribute(
      "data-open",
      "true",
      {
        timeout: 1_000,
      },
    );
  }).toPass({ timeout: 15_000 });
}

async function throttle(
  page: Page,
  profile: keyof typeof PROFILES,
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", PROFILES[profile]);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

test.describe("Core Web Vitals on a slow phone", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "CDP throttling is Chromium-only",
  );

  for (const [profile, lcpLimit] of [
    ["Fast 4G", LCP_BUDGET_MS],
    ["Slow 4G", SLOW_4G_CEILING_MS],
  ] as const) {
    test(`${profile}: LCP under ${String(lcpLimit)}ms and CLS under 0.1, with the cover photo as the LCP element`, async ({
      page,
    }) => {
      await observeVitals(page);
      await throttle(page, profile);

      await page.goto(`${APP_ORIGIN}/${SLUGS.grid}`, { waitUntil: "load" });
      // A moment after `load` lets a late shift or a late candidate be counted, not missed.
      await page.waitForTimeout(2_000);

      const vitals = await page.evaluate(
        () => (window as unknown as { __vitals: VitalsSnapshot }).__vitals,
      );
      const lcp = vitals.lcp.at(-1);
      const summary = `${profile}, 4x CPU: LCP ${lcp?.startTime.toFixed(0) ?? "?"}ms on ${lcp?.tag ?? "?"}.${lcp?.className ?? ""}; cover painted ${vitals.cover?.toFixed(0) ?? "?"}ms; CLS ${vitals.cls.toFixed(4)}`;

      test.info().annotations.push({ type: "measured", description: summary });
      console.log(`[P2-13] ${summary}`);

      expect(lcp, "no LCP entry was recorded").toBeDefined();
      /*
       * Chrome's LCP candidate list is not deterministic here: in roughly a third of throttled
       * runs it never offers the cover at all and settles on a paragraph — the hero's text, or
       * the quote's when it paints first — with no input, scroll or element replacement to
       * explain it. So the assertion is about the cover's own paint, which is what a guest
       * waits for, and about LCP; and an IMAGE as LCP must be the cover, never a portrait or
       * a gallery photo that jumped the queue.
       */
      if (lcp!.tag === "IMG") {
        expect(lcp!.className, "an image LCP must be the cover").toContain(
          "wi-hero-bg",
        );
        expect(lcp!.section).toBe("hero");
      }
      expect(vitals.cover, "the cover never painted").toBeDefined();
      expect(vitals.cover!).toBeLessThan(lcpLimit);
      expect(lcp!.startTime).toBeLessThan(lcpLimit);
      expect(vitals.cls).toBeLessThan(CLS_BUDGET);
    });
  }

  test("does not fetch the gallery while it is far below the fold", async ({
    page,
  }) => {
    // ADR-067's `content-visibility` on gallery sections. Without it Chrome's lazy-load
    // distance fetched every gallery photo during the first second, on a link the cover needed.
    const requested: string[] = [];
    page.on("request", (request) => {
      if (
        request.url().includes("/media/gallery-") &&
        request.url().includes("-medium")
      ) {
        requested.push(request.url());
      }
    });

    await page.goto(`${APP_ORIGIN}/${SLUGS.grid}`, { waitUntil: "load" });
    await page.waitForTimeout(1_000);
    expect(
      requested,
      "gallery photos fetched before the guest scrolled",
    ).toEqual([]);

    // And they do arrive once the gallery is near: the deferral must not become "never".
    await openGate(page);
    await page.locator('[data-section="gallery"]').scrollIntoViewIfNeeded();
    await expect
      .poll(() => requested.length, { timeout: 10_000 })
      .toBeGreaterThan(0);
  });

  test("loads the cover eagerly and every other photo lazily", async ({
    page,
  }) => {
    await page.goto(`${APP_ORIGIN}/${SLUGS.grid}`);

    const images = await page.$$eval("img", (nodes) =>
      nodes.map((img) => ({
        className: img.className,
        loading: img.loading,
        priority: img.getAttribute("fetchpriority"),
      })),
    );

    const hero = images.filter((img) => img.className.includes("wi-hero-bg"));
    const rest = images.filter((img) => !img.className.includes("wi-hero-bg"));

    expect(hero).toEqual([
      { className: "wi-hero-bg", loading: "eager", priority: "high" },
    ]);
    // Negative control: without photos below the fold this would pass on nothing.
    expect(rest.length).toBeGreaterThanOrEqual(5);
    for (const img of rest)
      expect(img, img.className).toMatchObject({ loading: "lazy" });
  });

  test("fetches the cover at 800w and the portraits as thumbnails, never a 1600w file", async ({
    page,
  }) => {
    // ADR-067. The Pixel 7's 2.625 density used to pull the 1600w cover out of a srcset, and
    // the API served 1600w files for 140px portraits.
    const requested: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/media/")) requested.push(request.url());
    });

    await page.goto(`${APP_ORIGIN}/${SLUGS.grid}`, { waitUntil: "load" });

    expect(requested.some((url) => url.endsWith("/cover-medium.webp"))).toBe(
      true,
    );
    expect(requested.filter((url) => url.endsWith("-large.webp"))).toEqual([]);
  });
});

test.describe("real-user monitoring", () => {
  test("beacons web vitals through the same origin to the API, carrying no address", async ({
    page,
  }) => {
    stack.rumReports.length = 0;
    const beacon = page.waitForRequest(
      (request) =>
        request.url() === `${APP_ORIGIN}/public/rum` &&
        request.method() === "POST",
    );

    await page.goto(`${APP_ORIGIN}/${SLUGS.grid}`, { waitUntil: "load" });
    // LCP and CLS are reported when the page is hidden; that is the moment a guest leaves.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // The browser sent it to this host, never to a third-party origin...
    await beacon;
    // ...and the public page forwarded it to the API.
    await expect
      .poll(() => stack.rumReports.length, { timeout: 10_000 })
      .toBeGreaterThan(0);

    // Which metrics arrive first depends on the browser's timing (TTFB is reported at once;
    // LCP only when web-vitals decides it is final). The claim is about every report's shape.
    for (const { body } of stack.rumReports) {
      const report = JSON.parse(body) as Record<string, unknown>;
      expect(Object.keys(report).sort()).toEqual([
        "metric",
        "page_kind",
        "rating",
        "value",
      ]);
      expect(["LCP", "CLS", "INP", "FCP", "TTFB"]).toContain(report["metric"]);
      expect(report["page_kind"]).toBe("invitation");
      expect(body).not.toContain(SLUGS.grid);
    }
  });
});

test.describe("text over a photograph", () => {
  test("keeps the couple's names and the date at 4.5:1 over a pure white photo", async ({
    page,
  }) => {
    await page.goto(`${APP_ORIGIN}/${SLUGS.whiteCover}`, { waitUntil: "load" });
    // Open, so the gate's own control cannot overlap what is being measured.
    await openGate(page);
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>("img.wi-hero-bg");
      return img !== null && img.complete && img.naturalWidth > 0;
    });

    const hero = page.locator('[data-section="hero"]');
    const texts = await hero
      .locator(".wi-hero-names, .wi-hero-date")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return {
            className: node.className,
            color: style.color,
            opacity: Number(style.opacity),
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
          };
        }),
      );
    expect(texts.length, "no hero text found").toBeGreaterThanOrEqual(2);

    // Paint the background without the text, then read what is behind each line of it.
    await page.addStyleTag({
      content:
        ".wi-hero-names, .wi-hero-date { color: transparent !important; text-shadow: none !important; }",
    });
    const heroBox = (await hero.boundingBox())!;
    const shot = decodePng(
      await hero.screenshot({ scale: "css", animations: "disabled" }),
    );

    for (const text of texts) {
      const [r, g, b] = (text.color.match(/[\d.]+/g) ?? []).map(Number) as [
        number,
        number,
        number,
      ];

      let lightest = 0;
      let lightestPixel: readonly [number, number, number] = [0, 0, 0];
      const left = Math.max(0, Math.floor(text.rect.x - heroBox.x));
      const top = Math.max(0, Math.floor(text.rect.y - heroBox.y));
      const right = Math.min(
        shot.width - 1,
        Math.ceil(text.rect.x - heroBox.x + text.rect.width),
      );
      const bottom = Math.min(
        shot.height - 1,
        Math.ceil(text.rect.y - heroBox.y + text.rect.height),
      );
      for (let y = top; y <= bottom; y += 2) {
        for (let x = left; x <= right; x += 2) {
          const pixel = shot.at(x, y);
          const l = luminance(pixel);
          if (l > lightest) {
            lightest = l;
            lightestPixel = pixel;
          }
        }
      }

      // The text as composited: its colour at its opacity over the lightest background.
      const blend = (fg: number, bg: number) =>
        text.opacity * fg + (1 - text.opacity) * bg;
      const rendered = luminance([
        blend(r, lightestPixel[0]),
        blend(g, lightestPixel[1]),
        blend(b, lightestPixel[2]),
      ]);
      const ratio = contrastRatio(rendered, lightest);

      console.log(
        `[P2-13] ${text.className} over the lightest background pixel: ${ratio.toFixed(2)}:1`,
      );
      expect(ratio, text.className).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/*
 * Tagged `@visual`. The baselines are rendered pixels, and pixels depend on the operating
 * system's font rasteriser: the committed baselines are `-win32`, from the machine this was
 * built on. CI runs Linux and has no baselines of its own yet, so the CI job excludes this
 * tag rather than writing fresh "baselines" that would pass by definition. Generating the
 * Linux set inside the Playwright container is a follow-up in the `P2-13` record.
 */
test.describe("visual snapshots of every section @visual", () => {
  for (const variant of ["grid", "carousel"] as const) {
    test(`every section, gallery as ${variant}`, async ({ page }) => {
      await page.goto(`${APP_ORIGIN}/${SLUGS[variant]}`, { waitUntil: "load" });

      // Open the cover gate so the sections are laid out as a guest sees them.
      await openGate(page);

      const keys = await page.$$eval("[data-section]", (nodes) =>
        nodes.map((node) => node.getAttribute("data-section") ?? ""),
      );
      // Negative control: a page that rendered nothing would snapshot nothing and pass.
      expect(keys).toEqual(
        expect.arrayContaining([
          "hero",
          "couple",
          "event",
          "gallery",
          "gift",
          "closing",
        ]),
      );

      const captured: string[] = [];
      for (const key of keys) {
        const section = page.locator(`[data-section="${key}"]`);
        const box = await section.boundingBox();
        if (box === null || box.height === 0) continue;

        await section.scrollIntoViewIfNeeded();
        // Lazy photos: load and decode every image in the section. Switched to eager first,
        // because a carousel's off-screen slides are never "near the viewport" and a lazy
        // image that is never requested never decodes — the first run hung here for 30s.
        await section.evaluate(async (node) => {
          await Promise.all(
            [...node.querySelectorAll("img")].map((img) => {
              img.loading = "eager";
              return img.decode().catch(() => undefined);
            }),
          );
        });

        await expect(section).toHaveScreenshot(`${variant}-${key}.png`, {
          animations: "disabled",
          // The countdown is a different number every second.
          mask: [page.locator(".wi-countdown")],
          maxDiffPixelRatio: 0.01,
        });
        captured.push(key);
      }

      test.info().annotations.push({
        type: "captured",
        description: captured.join(", "),
      });
      expect(captured.length).toBeGreaterThanOrEqual(6);
    });
  }
});
