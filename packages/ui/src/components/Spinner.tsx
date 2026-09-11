import { cx } from "../cx.js";

/**
 * The loading indicator, used by Button and Skeleton's siblings.
 *
 * `aria-hidden` and no text: it is decoration beside a label that says what is
 * happening. A spinner announced as "image" or "graphic" tells a screen-reader user
 * nothing, and announcing "loading" twice is worse than once.
 *
 * The animation is suppressed under `prefers-reduced-motion` by the base layer in
 * `tokens.css`, so this stops spinning rather than needing a variant.
 */
export function Spinner({ className }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className={cx("animate-spin", className)}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
