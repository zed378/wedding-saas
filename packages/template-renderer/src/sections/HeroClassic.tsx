import { useState } from "react";

import type { SectionProps } from "../types.js";
import { Photo, When, rows, text } from "./primitives.js";
import { readPath } from "../resolve-data.js";

/**
 * P2-03 — the cover. `docs/UI-UX/14` § Section Order 1.
 *
 * ## The cover gate, and why it is a real button
 *
 * The document asks for an "Open Invitation" button "to trigger music autoplay with a
 * user gesture — a modern browser requirement". That is the functional reason, and it is
 * not the only one: the gate is also what makes the first paint a single readable screen
 * rather than a page mid-scroll.
 *
 * It is a `<button>`, not a styled `<div>` with a click handler. A guest using a keyboard
 * or a screen reader reaches the whole invitation through this one control, so it is the
 * single most important interactive element on the page to get right.
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
export function HeroClassic({ data, mode }: SectionProps) {
  // `live` is the editor preview. A cover gate there would mean the couple sees a button
  // instead of their invitation every time the preview re-renders, which is the opposite
  // of a preview.
  const [opened, setOpened] = useState(mode === "live");

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

        {!opened && (
          <button
            type="button"
            className="wi-button"
            onClick={() => {
              setOpened(true);
            }}
          >
            Buka Undangan
          </button>
        )}
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
