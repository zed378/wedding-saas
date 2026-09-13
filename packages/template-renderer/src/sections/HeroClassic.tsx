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
 * White on a 45-65% black scrim clears 4.5:1 against **any** photograph. That is why this
 * one value is not themeable: letting a template author set it would let them break a
 * requirement `docs/UI-UX/17` does not make optional.
 */
export function HeroClassic({ data }: SectionProps) {
  const groom = text(readPath(data, ["couple", "groom", "nickname"]));
  const bride = text(readPath(data, ["couple", "bride", "nickname"]));
  const cover = coverPhoto(data);
  const date = text(readPath(data, ["events", "0", "date"]));

  const names = [groom, bride].filter(Boolean).join(" & ");

  return (
    <div className="wi-section wi-hero">
      {cover !== undefined && (
        <>
          <Photo src={cover} className="wi-hero-bg" />
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
function coverPhoto(data: Record<string, unknown>): string | undefined {
  const photos = rows(readPath(data, ["gallery", "photos"]));
  if (photos.length === 0) return undefined;

  const chosen =
    photos.find((photo) => photo["is_cover"] === true) ?? photos[0];
  return text(chosen?.["url"]);
}
