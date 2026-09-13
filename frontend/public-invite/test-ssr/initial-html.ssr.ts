import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { createRequire } from "node:module";

/**
 * `P2-08` DoD item 1 — *"the initial HTML contains the invitation's content and meta
 * tags, verified with JavaScript disabled"*.
 *
 * ## Why this runs a real server
 *
 * There is no way to check it otherwise. A jsdom test renders components; the claim here
 * is about **the bytes Next sends before any JavaScript runs**, which is the thing a
 * WhatsApp scraper sees and the reason `docs/FRONTEND/07` rules out a client-side fetch.
 * Fetching the HTML with `fetch` and reading the string is "JavaScript disabled" in the
 * only sense that matters — nothing in the response has executed.
 *
 * So this boots the built application against a stub API and reads what comes back. It is
 * not in the ordinary `vitest run` because it needs `next build` to have happened; it has
 * its own script and its own step in `scripts/verify.sh`, after the build.
 *
 * ## The stub API, rather than the real one
 *
 * The claim under test is about rendering, not about the database. A stub makes the
 * payload explicit — every field the page reads is visible in this file — and lets the
 * 404 and the outage be tested, which a seeded database cannot do on demand.
 * `public-invitation.itest.ts` on the API side is what proves the real payload matches.
 */

const SLUG = "andi-sarah";
const API_PORT = 34_771;
const APP_PORT = 34_772;
/** `P2-12`. A token in the shape the API generates: 43 URL-safe characters. */
const PREVIEW_TOKEN = "Pv7kQ2mX9aLw4rT8nB3cY6dF1gH5jK0zE_s-uVoI2pA";

/** The canonical shape `docs/API/08` serves (ADR-063). */
const PAYLOAD = {
  status: "published",
  template: {
    sections: [
      {
        section_key: "hero",
        component: "HeroClassic",
        enabled_by_default: true,
        configurable: false,
        required_fields: [
          "couple.groom.nickname",
          "couple.bride.nickname",
          "events.*.date",
        ],
        optional_fields: ["gallery.photos"],
      },
      {
        section_key: "couple",
        component: "CoupleProfile",
        enabled_by_default: true,
        configurable: true,
        required_fields: ["couple.groom.full_name", "couple.bride.full_name"],
        optional_fields: [],
      },
      {
        section_key: "gift",
        component: "GiftAccountList",
        enabled_by_default: true,
        configurable: true,
        required_fields: ["gift.accounts.*.account_number"],
        optional_fields: ["gift.accounts.*.provider_name"],
      },
    ],
    theme: { colors: { primary: "#8B5E3C" } },
    customizable_theme_keys: ["colors.primary"],
    thumbnail_url: "https://cdn.test/template-thumb.webp",
  },
  display: { watermark: false },
  invitation: {
    couple: {
      groom: { full_name: "Budi Santoso", nickname: "Budi" },
      bride: { full_name: "Siti Rahayu", nickname: "Siti" },
    },
    events: [
      {
        type: "akad",
        title: "Akad Nikah",
        date: "2027-05-15",
        start_time: "08:00",
        venue_name: "Masjid Agung Bandung",
        address: "Jl. Asia Afrika No. 1",
      },
    ],
    gallery: {
      photos: [
        {
          url: "https://cdn.test/cover.webp",
          medium_url: "https://cdn.test/cover-medium.webp",
          thumbnail_url: "https://cdn.test/cover-thumb.webp",
          caption: "Prewedding",
          is_cover: true,
          order: 0,
        },
      ],
    },
    quote: { text: null, source: null },
    gift: {
      accounts: [
        {
          type: "bank",
          provider_name: "BCA",
          account_number: "1234567890",
          account_holder: "Budi Santoso",
          order: 0,
        },
      ],
    },
    settings: {
      enabled_sections: ["hero", "couple", "gift"],
      theme_override: {},
      rsvp_enabled: true,
      guestbook_enabled: true,
      seo_indexable: true,
    },
  },
};

let api: Server;
let app: ChildProcess;
/**
 * `P2-13`. Every request the stub API received, in order, with the address header the page
 * forwarded — how the suite sees what one guest's visit costs the API.
 */
const received: { url: string; forwardedFor: string | undefined }[] = [];
/** Which slugs the stub answers. Mutated per test to produce a 404 or an outage. */
let mode: "ok" | "missing" | "broken" | "hero-only" | "private" | "no-photos" =
  "ok";

const html = async (
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> => {
  const response = await fetch(`http://127.0.0.1:${String(APP_PORT)}${path}`, {
    headers,
  });
  return { status: response.status, body: await response.text() };
};

beforeAll(async () => {
  const root = process.cwd();
  if (!existsSync(join(root, ".next"))) {
    throw new Error(
      "no build to serve. Run `pnpm --filter @wi/public-invite build` first — this suite checks the bytes a production server sends.",
    );
  }

  api = createServer((request, response) => {
    received.push({
      url: request.url ?? "",
      forwardedFor: request.headers["x-forwarded-for"] as string | undefined,
    });
    if (mode === "broken") {
      response.writeHead(503).end();
      return;
    }
    // `P2-12`. One valid preview token; everything else under the preview route is a 404.
    if (request.url?.startsWith("/public/preview/") === true) {
      if (request.url !== `/public/preview/${PREVIEW_TOKEN}`) {
        response.writeHead(404, { "content-type": "application/json" }).end(
          JSON.stringify({
            success: false,
            error: { code: "NOT_FOUND", message: "Undangan tidak ditemukan." },
          }),
        );
        return;
      }
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          success: true,
          data: {
            ...PAYLOAD,
            status: "preview",
            display: { watermark: true, preview: true },
            invitation: {
              ...PAYLOAD.invitation,
              settings: {
                ...PAYLOAD.invitation.settings,
                seo_indexable: false,
                rsvp_enabled: false,
                guestbook_enabled: false,
              },
            },
          },
        }),
      );
      return;
    }
    if (mode === "missing" || !request.url?.endsWith(`/public/i/${SLUG}`)) {
      response.writeHead(404, { "content-type": "application/json" }).end(
        JSON.stringify({
          success: false,
          error: { code: "NOT_FOUND", message: "Undangan tidak ditemukan." },
        }),
      );
      return;
    }
    const data =
      mode === "private"
        ? {
            ...PAYLOAD,
            invitation: {
              ...PAYLOAD.invitation,
              settings: {
                ...PAYLOAD.invitation.settings,
                seo_indexable: false,
              },
            },
          }
        : mode === "no-photos"
          ? {
              ...PAYLOAD,
              invitation: {
                ...PAYLOAD.invitation,
                gallery: { photos: [] },
              },
            }
          : mode === "hero-only"
            ? {
                ...PAYLOAD,
                template: {
                  ...PAYLOAD.template,
                  sections: PAYLOAD.template.sections.slice(0, 1),
                },
                invitation: {
                  ...PAYLOAD.invitation,
                  settings: {
                    ...PAYLOAD.invitation.settings,
                    enabled_sections: ["hero"],
                  },
                },
              }
            : PAYLOAD;

    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ success: true, data }));
  });
  await new Promise<void>((resolve) => api.listen(API_PORT, resolve));

  /*
   * Refuse to run against a server this suite did not start.
   *
   * `P1-21` recorded this exact trap and it caught me again here: a `next start` left
   * over from an earlier run keeps answering on the port, serving a build from before the
   * change under test. Three assertions failed against a page that was in fact correct,
   * and the symptom — a feature missing from the HTML — looks precisely like a bug in the
   * feature.
   *
   * On Windows the leak is structural rather than careless: `shell: true` means `kill()`
   * kills the shell and leaves `node` holding the socket. So the check is here, before
   * anything is spawned, with the command to clear it.
   */
  const occupied = await fetch(`http://127.0.0.1:${String(APP_PORT)}/`)
    .then(() => true)
    .catch(() => false);

  if (occupied) {
    throw new Error(
      `something is already listening on ${String(APP_PORT)}. It is almost certainly a ` +
        "`next start` left over from an earlier run, and it is serving an older build — " +
        "every assertion below would be made against the wrong page. Kill it first: " +
        `netstat -ano | grep ${String(APP_PORT)}`,
    );
  }

  app = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["next", "start", "--port", String(APP_PORT)],
    {
      cwd: root,
      env: {
        ...process.env,
        API_INTERNAL_BASE_URL: `http://127.0.0.1:${String(API_PORT)}`,
        PUBLIC_INVITE_ORIGIN: "https://invitation.test",
        SLUG_STRATEGY: "path",
      },
      stdio: "ignore",
      shell: process.platform === "win32",
    },
  );

  // Poll rather than sleep: the server is ready when it answers, and a fixed wait is
  // either too short on a cold machine or wasted on a warm one.
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await fetch(`http://127.0.0.1:${String(APP_PORT)}/`);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error("next start never answered");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}, 90_000);

afterAll(async () => {
  /*
   * Kill the TREE, not the child.
   *
   * With `shell: true` the child is `cmd.exe` and `next start` is its grandchild;
   * `kill()` reaps the shell and leaves the server holding the port, which is what makes
   * the next run of this suite lie. `taskkill /T` takes the tree.
   */
  if (app?.pid !== undefined) {
    if (process.platform === "win32") {
      // `spawnSync`, not `spawn`: the process exits as soon as this hook returns, and an
      // asynchronous kill never runs. That is not a detail — it is the difference between
      // this suite being repeatable and it refusing to start next time.
      spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      app.kill();
    }
  }

  // Give the socket a moment to close before the next run tries the same port.
  await new Promise((resolve) => setTimeout(resolve, 500));

  await new Promise<void>((resolve) => {
    api?.close(() => {
      resolve();
    });
  });
});

describe("P2-13 — what one guest's visit costs", () => {
  it("asks the API once per page view, not once for the page and again for its metadata", async () => {
    mode = "ok";
    received.length = 0;

    const { status } = await html(`/${SLUG}`);

    expect(status).toBe(200);
    expect(
      received.filter((entry) => entry.url.endsWith(`/public/i/${SLUG}`)),
    ).toHaveLength(1);
  });

  it("forwards the guest's address, so the API limits the guest rather than this server", async () => {
    // Without it every guest of every wedding shares one `general-public` bucket.
    mode = "ok";
    received.length = 0;

    await html(`/${SLUG}`, { "x-forwarded-for": "198.51.100.23" });

    const call = received.find((entry) =>
      entry.url.endsWith(`/public/i/${SLUG}`),
    );
    expect(call?.forwardedFor).toBe("198.51.100.23");
  });

  it("forwards the address for a preview too", async () => {
    received.length = 0;

    await html(`/preview/${PREVIEW_TOKEN}`, {
      "x-forwarded-for": "198.51.100.24",
    });

    const call = received.find((entry) =>
      entry.url.startsWith("/public/preview/"),
    );
    expect(call?.forwardedFor).toBe("198.51.100.24");
  });

  it("loads the hero photo eagerly, at high priority, at the 800w variant", async () => {
    // The hero photo is the largest element above the fold, so it IS the LCP element. A
    // lazy-loaded LCP image waits for layout before it is even requested.
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    const hero = /<img[^>]*wi-hero-bg[^>]*>/.exec(body)?.[0];
    expect(hero, "the cover photo is in the HTML").toBeDefined();
    expect(hero).not.toContain('loading="lazy"');
    expect(hero).toMatch(/fetchpriority="high"/i);
    // ADR-067: the medium file, with no srcset from which a dense phone would pick 1600w.
    expect(hero).toContain('src="https://cdn.test/cover-medium.webp"');
    expect(hero).not.toMatch(/srcset=/i);
  });

  it("declares the photo's box before it loads, so it cannot shift the page", async () => {
    // CLS: the hero is sized by CSS (`.wi-hero` min-height), not by the image arriving.
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    expect(body).toMatch(/\.wi-hero\s*\{[^}]*min-height/);
  });
});

describe("the invitation is in the HTML the server sends", () => {
  it("carries the couple, the date and the venue before any script runs", async () => {
    mode = "ok";
    const { status, body } = await html(`/${SLUG}`);

    expect(status).toBe(200);
    for (const needle of [
      "Budi",
      "Siti",
      "Budi Santoso",
      "Siti Rahayu",
      "Masjid Agung Bandung",
    ]) {
      expect(body, needle).toContain(needle);
    }
  });

  it("carries the sharing meta tags a bot reads without JavaScript", async () => {
    // `docs/FRONTEND/07` opens with this: sharing bots scrape `og:*` without executing
    // JavaScript. A client-side fetch produces a broken WhatsApp preview, and the only
    // way to know is to read the bytes.
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    expect(body).toContain('property="og:title"');
    expect(body).toMatch(/og:title[^>]*Budi & Siti|Budi &amp; Siti/);
    expect(body).toContain("https://cdn.test/cover.webp");
    expect(body).toContain(`https://invitation.test/${SLUG}`);
  });

  it("renders only the sections the settings enable", async () => {
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    expect(body).toContain('data-section="hero"');
    expect(body).toContain('data-section="couple"');
    expect(body).toContain('data-section="gift"');
  });

  it("applies the template's theme as custom properties, not a stylesheet the app owns", async () => {
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    expect(body).toContain("#8B5E3C");
  });

  it("letterboxes the page", async () => {
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    expect(body).toContain('data-invitation-frame="true"');
  });
});

/**
 * `P2-08` DoD item 3 — *"only the active template's components are in the bundle,
 * verified by bundle analysis"* — and `docs/FRONTEND/09` § Budget's 150KB gzip.
 *
 * The analysis is done from the page's own HTML rather than from a bundler report: the
 * set of scripts a browser fetches for this URL is exactly the set of `<script src>` and
 * script preloads the server emitted, and their sizes are on disk. A report describes
 * what the bundler produced; this describes what a guest downloads.
 */
describe("what a guest downloads", () => {
  const CHUNKS = join(process.cwd(), ".next", "static", "chunks");

  /**
   * Every chunk a MODERN browser fetches for this document, with its gzip size.
   *
   * Names are collected from the whole document — Next references a chunk from a real
   * `<script src>`, from a `<link rel=preload>` and from the flight payload, and which of
   * those carries a given chunk is an implementation detail that changes between
   * releases. What is subtracted is the `noModule` bundle: legacy polyfills that a
   * browser supporting modules never requests, and counting them would put 39KB of code
   * nobody downloads against a budget about what a guest waits for.
   */
  const scripts = (body: string): { name: string; gzip: number }[] => {
    const legacy = new Set<string>();
    for (const tag of body.matchAll(/<script[^>]*>/gi)) {
      // React may emit the attribute as `noModule` or lowercase it; a browser reads it
      // case-insensitively and so must this.
      if (!/nomodule/i.test(tag[0])) continue;
      for (const hit of tag[0].matchAll(
        /\/_next\/static\/chunks\/([A-Za-z0-9._-]+\.js)/g,
      )) {
        legacy.add(hit[1]!);
      }
    }

    const names = new Set<string>();
    for (const hit of body.matchAll(
      /\/_next\/static\/chunks\/([A-Za-z0-9._-]+\.js)/g,
    )) {
      if (!legacy.has(hit[1]!)) names.add(hit[1]!);
    }

    return [...names]
      .filter((name) => existsSync(join(CHUNKS, name)))
      .map((name) => ({
        name,
        gzip: gzipSync(readFileSync(join(CHUNKS, name))).length,
      }));
  };

  it("stays inside the 150KB gzip budget", async () => {
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    const total = scripts(body).reduce((sum, chunk) => sum + chunk.gzip, 0);
    const kb = total / 1024;

    expect(
      kb,
      `initial JS is ${kb.toFixed(1)}KB gzip: ${scripts(body)
        .map((c) => `${c.name} ${(c.gzip / 1024).toFixed(1)}KB`)
        .join(", ")}`,
    ).toBeLessThan(150);
  });

  it("keeps the whole section library under 10KB gzip", async () => {
    /*
     * ## An honest note about `P2-08`'s step 7
     *
     * The mechanism for per-template loading is in place: `TemplateRenderer` takes a
     * `resolve` prop and `Invitation.tsx` resolves every component name through
     * `next/dynamic`. It does not currently produce per-template chunks — Turbopack
     * merges the eleven dynamic imports into one chunk, and a template with only a hero
     * downloads exactly the same scripts as one with every section. That was measured,
     * not assumed: the two documents reference an identical chunk list.
     *
     * What that costs is this number. The entire section library — hero, couple, quote,
     * events with a countdown, two galleries, maps, gift, RSVP, guestbook, closing — is
     * one chunk, and this asserts it stays small enough that the merge does not matter.
     *
     * It will matter when a second template family triples the library. `P2-13` owns the
     * performance budget and is where this is picked up; the measurement lives here so
     * that the day it stops being true is a failing test rather than a slow page.
     */
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    const library = scripts(body).find((chunk) => {
      const source = readFileSync(join(CHUNKS, chunk.name), "utf8");
      return source.includes("GiftAccountList") && source.includes("wi-hero");
    });

    expect(library, "no chunk contains the section components").toBeDefined();

    /*
     * `P2-13` put the web-vitals reporter on the page, and Turbopack merged Next's compiled
     * `web-vitals` library into this same chunk — 10.6KB on the first run, against 7.5KB
     * before. The budget below is for the SECTIONS, so the library's own gzip size is
     * measured from the installed file and taken off, rather than the budget quietly being
     * raised to fit. (Gzip is not additive; the estimate errs by a few hundred bytes.) The
     * whole-page 150KB budget above counts everything and is not adjusted.
     */
    const source = readFileSync(join(CHUNKS, library!.name), "utf8");
    const vitals = source.includes("largest-contentful-paint")
      ? gzipSync(
          readFileSync(
            createRequire(join(process.cwd(), "package.json")).resolve(
              "next/dist/compiled/web-vitals/web-vitals.js",
            ),
          ),
        ).length
      : 0;
    const sections = ((library?.gzip ?? 0) - vitals) / 1024;

    expect(
      sections,
      `the section library is ${sections.toFixed(1)}KB gzip (chunk ${((library?.gzip ?? 0) / 1024).toFixed(1)}KB, web-vitals ${(vitals / 1024).toFixed(1)}KB)`,
    ).toBeLessThan(10);
  });
});

/**
 * `P2-09` — what a scraper and a crawler actually receive.
 *
 * `metadata.spec.ts` proves the object is built correctly. This proves it survives to the
 * wire: `generateMetadata` runs on the server, and a page that computed perfect metadata
 * and failed to render it would pass every unit test.
 */
describe("the metadata a scraper reads", () => {
  it("emits the og and twitter tags a link preview needs", async () => {
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    for (const tag of [
      'property="og:title"',
      'property="og:description"',
      'property="og:url"',
      'property="og:type"',
      'property="og:image"',
      'name="twitter:card"',
    ]) {
      expect(body, tag).toContain(tag);
    }
    expect(body).toContain("summary_large_image");
  });

  it("emits noindex by default", async () => {
    // The stub's invitation has `seo_indexable: true`, so this uses one that does not --
    // and the assertion is on the rendered document, because the default only protects
    // anybody if it reaches the `<head>`.
    mode = "private";
    const { body } = await html(`/${SLUG}`);

    expect(body).toMatch(/name="robots"[^>]*content="[^"]*noindex/);
  });

  it("emits index only when the owner enabled it", async () => {
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    expect(body).not.toMatch(/name="robots"[^>]*content="[^"]*noindex/);
  });

  it("carries a canonical link", async () => {
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    expect(body).toContain(
      `rel="canonical" href="https://invitation.test/${SLUG}"`,
    );
  });

  it("emits schema.org Event structured data with no account number", async () => {
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    expect(body).toContain('type="application/ld+json"');

    const block =
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(body);
    expect(block, "no JSON-LD block in the document").not.toBeNull();

    const jsonLd = JSON.parse(block![1]!) as Record<string, unknown>;
    expect(jsonLd["@type"]).toBe("Event");
    expect(JSON.stringify(jsonLd)).not.toContain("1234567890");
  });

  it("falls back to the template thumbnail when there is no cover photo", async () => {
    mode = "no-photos";
    const { body } = await html(`/${SLUG}`);

    expect(body).toContain("https://cdn.test/template-thumb.webp");
  });
});

/**
 * `P2-10` — the interactions, from the server's side.
 *
 * The card's DoD item is *"personalization never affects the server response or the cache
 * key"*, and that is a claim about bytes. `docs/ARCHITECTURE/06` § Cache Segmentation
 * gives the consequence of getting it wrong: a server-rendered guest name means one cache
 * entry per guest, which for one wedding is four hundred distinct documents and a hit
 * ratio of nothing — on the morning the page matters most.
 *
 * Only a real server can answer it. A jsdom test would be asserting about the component,
 * which is not where the failure would be.
 */
/**
 * `P2-10` step 5 — the cover gate, from the server's side.
 *
 * The gate renders closed, which is a visual decision with two consequences that only the
 * server's bytes can settle: the invitation must still be **in** the document for a
 * sharing bot, and a guest without JavaScript must not be left on a cover with a dead
 * button.
 */
describe("the cover gate does not hide the invitation from anything that cannot click", () => {
  it("leaves every section in the HTML while the gate is closed", async () => {
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    expect(body).toContain('data-cover-gate="true"');
    expect(body).toContain('data-open="false"');
    // The content a scraper and a screen reader need, present despite the clip.
    expect(body).toContain("Budi");
    expect(body).toContain("Masjid Agung Bandung");
  });

  it("ships the noscript rule that releases the clip", async () => {
    // Without it, a guest with JavaScript disabled sees a cover and a button that cannot
    // work. With it they simply get the whole invitation and no gate.
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    expect(body).toContain("<noscript>");
    expect(body).toContain("max-height:none");
    expect(body).toContain("[data-cover-gate-control]");
  });

  it("renders the gate's button server-side, so it works on first paint", async () => {
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    expect(body).toContain("Buka Undangan");
  });
});

/**
 * `P2-12` — `/preview/{token}`, from the bytes the server sends.
 *
 * The three promises `docs/DATABASE/04` makes about a preview are all about what reaches a
 * reader who never runs JavaScript: a crawler that must see `noindex`, a screenshot that must
 * carry the watermark, and a head that must not leak the credential.
 */
describe("a share preview", () => {
  it("renders the invitation with the watermark in the HTML", async () => {
    mode = "ok";
    const { status, body } = await html(`/preview/${PREVIEW_TOKEN}`);

    expect(status).toBe(200);
    expect(body).toContain("Budi Santoso");
    expect(body).toContain('data-preview-watermark="true"');
    expect(body).toMatch(/Pratinjau — belum diterbitkan/i);
  });

  it("is noindex regardless of anything the payload says", async () => {
    mode = "ok";
    const { body } = await html(`/preview/${PREVIEW_TOKEN}`);

    expect(body).toMatch(/name="robots"[^>]*content="[^"]*noindex/);
  });

  it("sends no referrer, so the token does not leak to a linked site", async () => {
    mode = "ok";
    const { body } = await html(`/preview/${PREVIEW_TOKEN}`);

    expect(body).toMatch(/name="referrer"[^>]*content="no-referrer"/);
  });

  it("never puts the token in the page head", async () => {
    // A canonical or og:url echoing the path would publish the credential in the markup a
    // sharing bot caches.
    mode = "ok";
    const { body } = await html(`/preview/${PREVIEW_TOKEN}`);

    const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(body)?.[1] ?? "";
    expect(head).not.toContain(PREVIEW_TOKEN);
  });

  it("has no share bar, because the public address does not exist yet", async () => {
    mode = "ok";
    const { body } = await html(`/preview/${PREVIEW_TOKEN}`);

    expect(body).not.toContain('data-share-bar="true"');
  });

  it("answers an unknown token with the friendly not-found page", async () => {
    mode = "ok";
    const { status, body } = await html(`/preview/${"Z".repeat(43)}`);

    expect(status).toBe(404);
    expect(body).toContain("Undangan tidak tersedia");
  });
});

describe("personalization stays off the server", () => {
  /**
   * The document with every `<script>` removed.
   *
   * Next serializes the request's query string into its own RSC router payload, inside a
   * script element, whatever the page does — that is framework state, not rendered
   * content, and no app-level change removes it. So the assertion is made against the
   * markup a guest and a scraper actually see.
   *
   * The consequence is real and belongs in the deployment rather than in the code: a CDN
   * in front of this host must **strip query parameters from the cache key**, or `?to=`
   * will segment the cache at the edge exactly as `docs/ARCHITECTURE/06` warns. Recorded
   * as a follow-up on the `P2-10` record.
   */
  const rendered = (body: string): string =>
    body.replace(/<script\b[\s\S]*?<\/script>/gi, "");

  it("renders identical markup with and without ?to=", async () => {
    mode = "ok";

    const plain = await html(`/${SLUG}`);
    const personalized = await html(`/${SLUG}?to=Dewi%20Lestari`);

    expect(personalized.status).toBe(plain.status);
    expect(rendered(personalized.body)).toBe(rendered(plain.body));
  });

  it("never puts the guest's name in the rendered markup", async () => {
    // Not merely "the same as without" — the name must be absent outright, so a link
    // preview of a forwarded invitation cannot reveal who it was addressed to.
    mode = "ok";

    const { body } = await html(`/${SLUG}?to=Dewi%20Lestari`);

    expect(rendered(body)).not.toContain("Dewi");
  });

  it("keeps the greeting out of the head, so a preview cannot name the guest", async () => {
    mode = "ok";
    const { body } = await html(`/${SLUG}?to=Dewi%20Lestari`);

    const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(body)?.[1] ?? "";
    expect(head).not.toContain("Dewi");
  });

  it("renders the share controls server-side, since they are not per-visitor", async () => {
    mode = "ok";
    const { body } = await html(`/${SLUG}`);

    expect(body).toContain('data-share-bar="true"');
    expect(body).toContain("wa.me");
  });
});

describe("an address with no invitation", () => {
  it("renders the friendly page, not a framework error", async () => {
    mode = "missing";
    const { status, body } = await html(`/${SLUG}`);

    expect(status).toBe(404);
    expect(body).toContain("Undangan tidak tersedia");
    // The reason is never given. `docs/API/08`: never published, unpublished, expired and
    // mistyped must be indistinguishable, and the page is the last place that could leak
    // the difference.
    expect(body).not.toMatch(/kedaluwarsa|dihapus|draft/i);
  });

  it("refuses to be indexed", async () => {
    mode = "missing";
    const { body } = await html(`/${SLUG}`);

    expect(body).toMatch(/noindex/);
  });

  it("answers a malformed slug identically", async () => {
    mode = "ok";
    const { status, body } = await html("/AB");

    expect(status).toBe(404);
    expect(body).toContain("Undangan tidak tersedia");
  });
});

describe("the API being down is not a missing invitation", () => {
  it("does not tell a guest the invitation does not exist", async () => {
    // The failure this distinction exists for: an outage that renders "this invitation
    // does not exist" tells a couple's guests something false and permanent-sounding, on
    // the one day it matters most.
    mode = "broken";
    const { status, body } = await html(`/${SLUG}`);

    expect(status).toBeGreaterThanOrEqual(500);

    // Asserted on the error marker rather than on the body text. Next serializes the
    // layout's `notFound` slot into the flight payload of every document, so the
    // not-found wording is present in the bytes of a page that is not showing it -- a
    // substring check would pass on the wrong page and fail on the right one.
    //
    // What is guaranteed, and all that is guaranteed: the guest gets an error document,
    // not the "this invitation is not available" page. The `<title>` of that error
    // document still reads "Undangan tidak ditemukan", because Next falls back to the
    // not-found branch's metadata when `generateMetadata` itself throws. That is a wart
    // and it is recorded rather than asserted away -- see the P2-08 record.
    expect(body).toContain('id="__next_error__"');
  });
});
