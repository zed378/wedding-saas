import { cx } from "../cx.js";

/**
 * P0-22 — Avatar / photo preview. `docs/UI-UX/06`: "with a crop indicator".
 *
 * ## The alt text rule
 *
 * `name` is required and becomes the alt text. There is no way to render this component
 * without one, because "avatar" and "profile picture" are the two most common useless
 * alt texts on the web and both are what you get when the prop is optional.
 *
 * When there is no image, the initials are shown — and the *element* still carries the
 * name, so a screen reader says "Budi Santoso" rather than spelling out "BS".
 *
 * ## The crop indicator
 *
 * A frame overlay showing what a square crop will keep, for the editor's photo picker.
 * Purely decorative and `aria-hidden`: it communicates something only a sighted user is
 * making a decision about, and the decision itself (which photo) is available another
 * way.
 */

export type AvatarSize = "sm" | "md" | "lg" | "xl";

const SIZE: Record<AvatarSize, string> = {
  sm: "size-8 text-body-sm",
  md: "size-12 text-body",
  lg: "size-16 text-h3",
  xl: "size-24 text-h2",
};

export interface AvatarProps {
  /** Used as alt text, and as the source of the initials fallback. Required. */
  readonly name: string;
  readonly src?: string | undefined;
  readonly size?: AvatarSize | undefined;
  /** Draws the square crop frame over the image. */
  readonly showCropIndicator?: boolean | undefined;
  readonly className?: string | undefined;
}

export function Avatar({
  name,
  src,
  size = "md",
  showCropIndicator = false,
  className,
}: AvatarProps) {
  return (
    <span
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        "bg-primary-100 font-semibold text-primary-800",
        SIZE[size],
        className,
      )}
    >
      {src === undefined ? (
        <>
          <span aria-hidden="true">{initials(name)}</span>
          {/* The initials are a visual shorthand; the name is the information. */}
          <span className="sr-only">{name}</span>
        </>
      ) : (
        <img
          src={src}
          alt={name}
          // Photos on a public invitation are the heaviest thing on the page
          // (docs/ARCHITECTURE/06). An avatar is never above the fold in the app chrome.
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      )}

      {showCropIndicator && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-dashed border-surface-raised/80"
        />
      )}
    </span>
  );
}

/**
 * Up to two initials.
 *
 * `Array.from` rather than `split("")` so a name whose first character is outside the
 * Basic Multilingual Plane does not produce half a surrogate pair — which renders as a
 * replacement character rather than a letter.
 */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";

  const letters = words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("");

  return letters.toUpperCase();
}
