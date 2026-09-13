"use client";

/*
 * `P2-08`. This module is a client component because `P2-03` gated the cover with
 * `useState`. `P2-10` moved the gate out (see below) and the hook went with it, but the
 * directive stays: the file is imported by `public-invite`'s client boundary alongside
 * its interactive siblings, and marking it server-only would split the section library
 * across the boundary for no gain.
 */

import type { SectionProps } from "../types.js";
import { Photo, When, rows, text } from "./primitives.js";
import { readPath } from "../resolve-data.js";

/**
 * P2-03 — the cover. `docs/UI-UX/14` § Section Order 1.
 *
 * ## The cover gate is NOT here, and used not to be a gate at all
 *
 * `P2-03` put an "Open Invitation" button in this component. It hid **itself** on click
 * while every section below stayed rendered and scrollable — so it was a button that
 * removed a button, and the "single readable first screen" the document asks for never
 * happened.
 *
 * A section cannot gate its siblings; it has no access to them. `P2-10` moved the control
 * to `public-invite`'s `CoverGate`, which wraps the whole invitation and can actually
 * contain it. This component is now just the cover, which is all a section can be.
 *
 * ## Contrast over a photograph
 *
 * `docs/UI-UX/14` § Accessibility: "sufficient text contrast even over a photo background
 * (a gradient overlay if needed)". The overlay is not optional here and not a style
 * choice — a cover photo is chosen by the couple and can be any brightness, so the only
 * way to guarantee the ratio is to darken the image rather than to pick a text colour
 * against it.
 *
 * The scrim runs from 60% to 70% black, and that floor is computed rather than chosen:
 * `hero-contrast.spec.ts` blends it over a pure white pixel — the worst photograph there is —
 * and requires 4.5:1 for the white text above it, including the date at 92% opacity.
 *
 * It used to be 45% to 65%, with this comment claiming 4.5:1 against any photograph. The
 * arithmetic says otherwise: white over 45% black on a white photo is about 3.4:1, which
 * fails for the date and the "Kami akan menikah" line. `P2-13` found it by doing the sum the
 * comment described.
 *
 * Not themeable: letting a template author set it would let them break a requirement
 * `docs/UI-UX/17` does not make optional.
 *
 * ## The 800w variant, not a srcset (`P2-13`, ADR-067)
 *
 * The cover is the page's LCP element, and on the slow-4G phone `docs/FRONTEND/09` budgets
 * for, bytes are the whole story. A srcset of all three variants let a 2.6x-DPR phone pick
 * the 1600w file — 144KB where 84KB would do — and the browser suite measured LCP at 4.0s
 * against 2.6s for the same page with the medium file.
 *
 * The medium variant is enough by construction rather than by taste: the hero is never wider
 * than the 26rem letterbox (`P2-08`), so 800 pixels covers it at up to 1.9x density, and above
 * that the upscale sits under a 60-70% black scrim that hides exactly the detail it would
 * lose. `url` (the large file) is only the fallback for a photo row with no medium variant.
 *
 * ## No blurred-thumbnail placeholder
 *
 * Tried and removed in `P2-13`. Chrome discounts an upscaled image's area by its natural
 * size, so a 300w thumbnail stretched over the hero is a SMALLER LCP candidate than the 800w
 * file that replaces it — LCP stayed on the sharp image and got ~80ms later, because the
 * placeholder's bytes share the same slow link.
 */
export function HeroClassic({ data }: SectionProps) {
  const groom = text(readPath(data, ["couple", "groom", "nickname"]));
  const bride = text(readPath(data, ["couple", "bride", "nickname"]));
  const cover = coverPhoto(data);
  const date = text(readPath(data, ["events", "0", "date"]));

  const names = [groom, bride].filter(Boolean).join(" & ");
  const sharp =
    cover === undefined
      ? undefined
      : (text(cover["medium_url"]) ?? text(cover["url"]));

  return (
    <div className="wi-section wi-hero">
      {sharp !== undefined && (
        <>
          <Photo src={sharp} className="wi-hero-bg" priority />
          {/* Decorative and non-interactive: it exists so the text above it is legible. */}
          <div className="wi-hero-scrim" aria-hidden="true" />
        </>
      )}

      <div className="wi-stack wi-center">
        <p className="wi-hero-date">Kami akan menikah</p>
        <h1 className="wi-hero-names">{names}</h1>
        <When value={date}>
          {(present) => <p className="wi-hero-date">{present}</p>}
        </When>
      </div>
    </div>
  );
}

/**
 * The cover photo: the one flagged `is_cover`, else the first.
 *
 * `P1-19` guarantees at most one cover per invitation, so this cannot be ambiguous. The
 * fallback matters for a draft the couple has not chosen a cover for yet — the preview
 * should show something rather than an empty hero.
 */
function coverPhoto(
  data: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const photos = rows(readPath(data, ["gallery", "photos"])).filter(
    (photo) => text(photo["url"]) !== undefined,
  );
  if (photos.length === 0) return undefined;

  return photos.find((photo) => photo["is_cover"] === true) ?? photos[0];
}
