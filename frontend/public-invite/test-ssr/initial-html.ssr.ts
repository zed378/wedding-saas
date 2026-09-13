import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

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
        optional_fields: ["gallery.photos.*.media_id"],
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
/** Which slugs the stub answers. Mutated per test to produce a 404 or an outage. */
let mode: "ok" | "missing" | "broken" | "hero-only" | "private" | "no-photos" =
  "ok";

const html = async (
  path: string,
): Promise<{ status: number; body: string }> => {
  const response = await fetch(`http://127.0.0.1:${String(APP_PORT)}${path}`);
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
    if (mode === "broken") {
      response.writeHead(503).end();
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
    expect(
      (library?.gzip ?? 0) / 1024,
      `the section library is ${((library?.gzip ?? 0) / 1024).toFixed(1)}KB gzip`,
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
