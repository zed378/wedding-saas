/**
 * P2-13 — the photographs the performance suite serves.
 *
 * Regenerate with:  node e2e/fixtures/perf/generate-photos.mjs
 *
 * Synthetic, not real: a real couple's photo cannot be committed, and a stock photo brings a
 * licence. What matters to LCP is bytes and dimensions, so these are sized like the variants
 * the media worker produces (docs/BACKEND/05: thumbnail 300w, medium 800w, large 1600w) and
 * compressed to about what a real portrait photo weighs at that width — smooth gradients
 * with grain, which WebP cannot squeeze to nothing the way a flat colour would be.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  join(here, "../../../backend/worker/package.json"),
);
const sharp = require("sharp");

const WIDTHS = { thumb: 300, medium: 800, large: 1600 };
const PHOTOS = [
  { name: "cover", hue: [120, 80, 60] },
  { name: "gallery-1", hue: [60, 90, 120] },
  { name: "gallery-2", hue: [140, 120, 70] },
  { name: "gallery-3", hue: [90, 60, 100] },
  { name: "gallery-4", hue: [70, 110, 90] },
];

function pixels(width, height, [r, g, b], seed, amplitude) {
  const data = Buffer.alloc(width * height * 3);
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const fx = x / width;
      const fy = y / height;
      const light = 0.55 + 0.45 * Math.sin(fx * 3.1 + fy * 2.3);
      const grain = (random() - 0.5) * amplitude;
      const i = (y * width + x) * 3;
      data[i] = Math.max(0, Math.min(255, r * light + 90 * fy + grain));
      data[i + 1] = Math.max(0, Math.min(255, g * light + 60 * fx + grain));
      data[i + 2] = Math.max(0, Math.min(255, b * light + 40 + grain));
    }
  }
  return data;
}

/** Grain per width, tuned so each variant weighs about what a real photo does. */
const GRAIN = { thumb: 22, medium: 18, large: 13 };

for (const [index, photo] of PHOTOS.entries()) {
  for (const [variant, width] of Object.entries(WIDTHS)) {
    const height = Math.round(width * 1.25);
    const raw = pixels(width, height, photo.hue, 7 + index, GRAIN[variant]);
    const out = join(here, `${photo.name}-${variant}.webp`);
    const info = await sharp(raw, { raw: { width, height, channels: 3 } })
      .webp({ quality: 80 })
      .toFile(out);
    console.log(
      `${photo.name}-${variant}.webp ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)}KB`,
    );
  }
}

/*
 * The worst case for text over a photo: pure white. The contrast measurement in
 * `public-performance.e2e.ts` renders the hero over this and reads the pixels behind the
 * couple's names, because a real photo's lightest patch is at most this light.
 */
{
  const width = 1600;
  const height = 2000;
  const info = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .webp({ quality: 80 })
    .toFile(join(here, "white-large.webp"));
  console.log(
    `white-large.webp ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)}KB`,
  );
}
