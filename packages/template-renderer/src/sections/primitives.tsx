import type { ReactNode } from "react";

/**
 * P2-03 — the pieces every section is built from.
 *
 * Not a design system: `@wi/ui` is that, and it is deliberately unreachable from here.
 * `@wi/ui` is application chrome and carries the dashboard's palette; an invitation's
 * colours are per-template data (`docs/PLAN/07`), so a section importing a `@wi/ui`
 * button would give every wedding the dashboard's indigo.
 *
 * These are the three or four shapes that would otherwise be repeated ten times.
 */

/** A string that is present and not only whitespace. */
export function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Render `children` only when `value` is present.
 *
 * `docs/PLAN/07` § Required vs Optional: "an absent caption leaves no empty box behind".
 * The whole reason this exists as a helper is that the failure is invisible in review —
 * an empty `<p>` still has margin, and ten sections each getting it slightly differently
 * is how a page ends up with gaps nobody can explain.
 */
export function When({
  value,
  children,
}: {
  readonly value: unknown;
  readonly children: (present: string) => ReactNode;
}) {
  const present = text(value);
  if (present === undefined) return null;
  return <>{children(present)}</>;
}

export function SectionShell({
  title,
  className,
  children,
}: {
  readonly title?: string | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className={["wi-section", className].filter(Boolean).join(" ")}>
      {title !== undefined && <h2 className="wi-center">{title}</h2>}
      {children}
    </div>
  );
}

/**
 * An image that is decorative unless it is given a description.
 *
 * `alt=""` is the correct alt text for decoration and the incorrect one for a photograph
 * of the couple — `docs/UI-UX/17` asks for "real alt text". Making the caption the source
 * means a captioned photo is described and an uncaptioned one is explicitly decorative,
 * which is a better default than inventing "photo 3 of 12".
 */
export function Photo({
  src,
  caption,
  className,
  srcSet,
  sizes,
  priority = false,
}: {
  readonly src: string;
  readonly caption?: string | undefined;
  readonly className?: string | undefined;
  /** `P2-13`. The pre-generated variants (`thumbnail` 300w, `medium` 800w, `large` 1600w). */
  readonly srcSet?: string | undefined;
  readonly sizes?: string | undefined;
  /**
   * `P2-13`. The LCP image: loaded eagerly at high priority.
   *
   * `docs/FRONTEND/09`: "`priority`/eager loading only for the cover photo (the LCP element)".
   * Every photo used to be `loading="lazy"`, including the cover — which tells the browser to
   * defer the single most important image on the page until layout decides it is near the
   * viewport, and costs the whole LCP budget on a slow phone.
   */
  readonly priority?: boolean;
}) {
  return (
    <img
      className={className ?? "wi-photo"}
      src={src}
      {...(srcSet === undefined ? {} : { srcSet })}
      {...(sizes === undefined ? {} : { sizes })}
      alt={caption ?? ""}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      // React 19 passes `fetchPriority` through as the `fetchpriority` attribute.
      {...(priority ? { fetchPriority: "high" as const } : {})}
      // Element Timing: the LCP image's paint time, observable on its own. Chrome does not
      // always make the cover an LCP candidate (`P2-13` saw it skipped in about a third of
      // throttled runs with no input, scroll or replacement), so the browser suite measures
      // the cover's paint directly instead of trusting the candidate list.
      {...(priority ? { elementtiming: "wi-lcp-image" } : {})}
    />
  );
}

/**
 * `P2-13` — a `srcset` from the variants a photo row carries, or `undefined`.
 *
 * Only variants that are actually present: a photo from an older payload, or one still being
 * processed, has fewer URLs, and a `srcset` naming a URL that does not exist is worse than none.
 */
export function variantSrcSet(
  photo: Readonly<Record<string, unknown>>,
): string | undefined {
  const candidates: [unknown, number][] = [
    [photo["thumbnail_url"], 300],
    [photo["medium_url"], 800],
    [photo["url"], 1600],
  ];

  const entries = candidates
    .filter(
      (candidate): candidate is [string, number] =>
        typeof candidate[0] === "string" && candidate[0].length > 0,
    )
    .map(([url, width]) => `${url} ${String(width)}w`);

  return entries.length > 1 ? entries.join(", ") : undefined;
}

/** Rows of a collection, already narrowed by the resolver. */
export function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? (value.filter((row) => row !== null && typeof row === "object") as Record<
        string,
        unknown
      >[])
    : [];
}
