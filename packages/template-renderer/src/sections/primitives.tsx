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
}: {
  readonly src: string;
  readonly caption?: string | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <img
      className={className ?? "wi-photo"}
      src={src}
      alt={caption ?? ""}
      loading="lazy"
      decoding="async"
    />
  );
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
