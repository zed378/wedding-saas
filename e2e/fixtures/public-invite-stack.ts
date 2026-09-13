import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

/**
 * `P2-13` — the built public invitation, served against a stub API, for a real browser.
 *
 * The same arrangement as `frontend/public-invite/test-ssr/initial-html.ssr.ts`, for the
 * same reason: the claims under test are about what a browser does with the bytes a
 * production build sends, not about the database. Two differences:
 *
 * - The template is the **reference template itself**, read from the seed file the API
 *   installs, so the page measured is the page a customer gets — every section, in the
 *   order the template puts them.
 * - The stub also serves photographs (`fixtures/perf/*.webp`, sized like the media
 *   worker's variants), because LCP on a page whose cover photo 404s measures the text.
 */

// Playwright compiles this package to CommonJS, where `__dirname` is the module's directory.
const here = __dirname;
const ROOT = join(here, "..", "..");
const PUBLIC_INVITE = join(ROOT, "frontend", "public-invite");
const PHOTOS = join(here, "perf");

export const STACK_API_PORT = 34_781;
export const STACK_APP_PORT = 34_782;
export const APP_ORIGIN = `http://127.0.0.1:${String(STACK_APP_PORT)}`;
const API_ORIGIN = `http://127.0.0.1:${String(STACK_API_PORT)}`;

/** The slugs the stub answers, one per variant the suite needs. */
export const SLUGS = {
  grid: "perf-grid",
  carousel: "perf-carousel",
  whiteCover: "perf-white-cover",
} as const;

interface ReferenceTemplate {
  sections: {
    section_key: string;
    enabled_by_default: boolean;
    [key: string]: unknown;
  }[];
  theme: Record<string, unknown>;
  customizable_theme_keys: string[];
}

const reference = JSON.parse(
  readFileSync(
    join(
      ROOT,
      "backend",
      "api",
      "src",
      "infra",
      "db",
      "seed-data",
      "reference-template.json",
    ),
    "utf8",
  ),
) as ReferenceTemplate;

const photo = (name: string, extra: Record<string, unknown> = {}) => ({
  url: `${API_ORIGIN}/media/${name}-large.webp`,
  medium_url: `${API_ORIGIN}/media/${name}-medium.webp`,
  thumbnail_url: `${API_ORIGIN}/media/${name}-thumb.webp`,
  ...extra,
});

/** A representative invitation: every section the reference template has, filled in. */
function payload(variant: keyof typeof SLUGS) {
  const sections = reference.sections.map((section) =>
    section.section_key === "gallery"
      ? {
          ...section,
          layout_variant: variant === "carousel" ? "carousel" : "grid",
        }
      : section,
  );

  const cover =
    variant === "whiteCover"
      ? {
          url: `${API_ORIGIN}/media/white-large.webp`,
          is_cover: true,
          order: 0,
        }
      : photo("cover", {
          caption: "Prewedding di Lembang",
          is_cover: true,
          order: 0,
        });

  return {
    status: "published",
    template: {
      sections,
      theme: reference.theme,
      customizable_theme_keys: reference.customizable_theme_keys,
      thumbnail_url: null,
    },
    display: { watermark: false },
    invitation: {
      couple: {
        // The thumbnail, as the API serves a portrait (ADR-067).
        groom: {
          full_name: "Andi Pratama",
          nickname: "Andi",
          father_name: "Bapak Hendra",
          mother_name: "Ibu Ratna",
          child_order: "Putra pertama",
          photo: `${API_ORIGIN}/media/gallery-1-thumb.webp`,
        },
        bride: {
          full_name: "Sarah Wijaya",
          nickname: "Sarah",
          father_name: "Bapak Joko",
          mother_name: "Ibu Lestari",
          child_order: "Putri kedua",
          photo: `${API_ORIGIN}/media/gallery-2-thumb.webp`,
        },
      },
      events: [
        {
          type: "akad",
          title: "Akad Nikah",
          date: "2027-05-15",
          start_time: "08:00",
          end_time: "10:00",
          venue_name: "Masjid Agung Bandung",
          address: "Jl. Asia Afrika No. 1, Bandung",
          maps_url: "https://maps.google.com/?q=-6.9218,107.6071",
        },
        {
          type: "resepsi",
          title: "Resepsi",
          date: "2027-05-15",
          start_time: "11:00",
          end_time: "14:00",
          venue_name: "Gedung Sate",
          address: "Jl. Diponegoro No. 22, Bandung",
          maps_url: "https://maps.google.com/?q=-6.9025,107.6188",
        },
      ],
      gallery: {
        photos: [
          cover,
          photo("gallery-1", { caption: "Pertama bertemu", order: 1 }),
          photo("gallery-2", { order: 2 }),
          photo("gallery-3", { order: 3 }),
          photo("gallery-4", { order: 4 }),
        ],
      },
      quote: {
        text: "Dan di antara tanda-tanda kekuasaan-Nya ialah Dia menciptakan untukmu pasangan hidup dari jenismu sendiri.",
        source: "QS. Ar-Rum: 21",
      },
      gift: {
        accounts: [
          {
            type: "bank",
            provider_name: "BCA",
            account_number: "1234567890",
            account_holder: "Andi Pratama",
            order: 0,
          },
        ],
      },
      settings: {
        enabled_sections: reference.sections.map(
          (section) => section.section_key,
        ),
        theme_override: {},
        rsvp_enabled: true,
        guestbook_enabled: true,
        seo_indexable: false,
      },
    },
  };
}

export interface Stack {
  /**
   * Every body `POST /public/rum` delivered to the stub API, with the address header the
   * public page's forward sent along — so a test sees what actually crossed the hop, which a
   * browser-side request listener cannot (Playwright does not expose a beacon's Blob body).
   */
  readonly rumReports: { body: string; forwardedFor: string | undefined }[];
  stop(): Promise<void>;
}

export async function startPublicInviteStack(): Promise<Stack> {
  if (!existsSync(join(PUBLIC_INVITE, ".next"))) {
    throw new Error(
      "no public-invite build to serve. Run `pnpm --filter @wi/public-invite build` first.",
    );
  }

  const bySlug = new Map(
    (Object.keys(SLUGS) as (keyof typeof SLUGS)[]).map((variant) => [
      `/public/i/${SLUGS[variant]}`,
      JSON.stringify({ success: true, data: payload(variant) }),
    ]),
  );

  const rumReports: Stack["rumReports"] = [];

  const api: Server = createServer((request, response) => {
    const url = request.url ?? "";

    if (url.startsWith("/media/")) {
      const name = url.slice("/media/".length);
      // No path in a name, so nothing outside the fixture directory can be requested.
      if (!/^[a-z0-9-]+\.webp$/.test(name) || !existsSync(join(PHOTOS, name))) {
        response.writeHead(404).end();
        return;
      }
      response
        .writeHead(200, {
          "content-type": "image/webp",
          "cache-control": "public, max-age=31536000, immutable",
          // What the CDN must send too (ADR-067): without it a cross-origin image's paint
          // time is hidden from the page, and RUM reports its load time instead.
          "timing-allow-origin": "*",
        })
        .end(readFileSync(join(PHOTOS, name)));
      return;
    }

    if (url === "/public/rum") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        rumReports.push({
          body: Buffer.concat(chunks).toString("utf8"),
          forwardedFor: request.headers["x-forwarded-for"] as
            string | undefined,
        });
        response.writeHead(204).end();
      });
      return;
    }

    const body = bySlug.get(url);
    if (body === undefined) {
      response.writeHead(404, { "content-type": "application/json" }).end(
        JSON.stringify({
          success: false,
          error: { code: "NOT_FOUND", message: "-" },
        }),
      );
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(body);
  });
  await new Promise<void>((resolve) =>
    api.listen(STACK_API_PORT, "127.0.0.1", resolve),
  );

  // A leftover `next start` would serve an older build and every measurement would be of
  // the wrong page — the trap `P1-21` and `P2-09` both recorded.
  const occupied = await fetch(`${APP_ORIGIN}/`).then(
    () => true,
    () => false,
  );
  if (occupied) {
    api.close();
    throw new Error(
      `something is already listening on ${String(STACK_APP_PORT)} — almost certainly a stale ` +
        "`next start` serving an older build. Kill it first.",
    );
  }

  const app: ChildProcess = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["next", "start", "--port", String(STACK_APP_PORT)],
    {
      cwd: PUBLIC_INVITE,
      env: {
        ...process.env,
        API_INTERNAL_BASE_URL: API_ORIGIN,
        PUBLIC_INVITE_ORIGIN: APP_ORIGIN,
        SLUG_STRATEGY: "path",
        NODE_ENV: "production",
      },
      stdio: "ignore",
      shell: process.platform === "win32",
    },
  );

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await fetch(`${APP_ORIGIN}/`);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error("next start never answered");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  return {
    rumReports,
    async stop() {
      if (app.pid !== undefined) {
        if (process.platform === "win32") {
          // The tree, synchronously: `shell: true` makes `next` a grandchild, and `kill()`
          // would leave it holding the port for the next run.
          spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], {
            stdio: "ignore",
          });
        } else {
          app.kill();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      await new Promise<void>((resolve) => api.close(() => resolve()));
    },
  };
}
