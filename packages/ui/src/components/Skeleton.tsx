import { cx } from "../cx.js";

/**
 * P0-22 — Skeleton. `docs/UI-UX/06`: "for all async loading states".
 *
 * ## It is not announced
 *
 * `aria-hidden`, always. A screen reader reading out six grey rectangles is worse than
 * silence. The loading STATE is announced once, by the region that contains the
 * skeletons (`aria-busy` on the container, or a `role="status"` with a word in it) --
 * which is why `SkeletonList` takes a label and the individual bars do not.
 */
export function Skeleton({
  className,
  rounded = "md",
}: {
  readonly className?: string | undefined;
  readonly rounded?: "sm" | "md" | "lg" | "full" | undefined;
}) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        "animate-pulse bg-surface-sunken",
        rounded === "sm" && "rounded-sm",
        rounded === "md" && "rounded-md",
        rounded === "lg" && "rounded-lg",
        rounded === "full" && "rounded-full",
        className,
      )}
    />
  );
}

/**
 * A block of skeletons with one announcement for the whole thing.
 *
 * `label` is what a screen reader says -- "Memuat daftar undangan", not "loading" --
 * because a user with three tabs open needs to know which thing is loading.
 */
export function SkeletonList({
  rows = 3,
  label,
  className,
}: {
  readonly rows?: number | undefined;
  readonly label: string;
  readonly className?: string | undefined;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cx("flex flex-col gap-3", className)}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
