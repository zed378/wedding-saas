import { cx } from "../cx.js";

/**
 * The Button's appearance, separated from the Button.
 *
 * It lives in its own module with **no `"use client"` directive**, because it is a pure
 * string function and a server component has every right to call it. `Button.tsx` is a
 * client component (it takes an `onClick`), and anything exported from a client module
 * -- even a function that touches nothing -- is unreachable from the server: Next.js
 * replaces it with a reference the server cannot invoke.
 *
 * That is not a hypothetical. The app's home page renders a `<Link>` styled as a button
 * and the build failed with "Attempted to call buttonClassName() from the server".
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-primary-600 text-text-inverse hover:bg-primary-700 active:bg-primary-800",
  secondary:
    "bg-surface-raised text-text border border-border-strong hover:bg-surface-sunken active:bg-neutral-200",
  ghost:
    "bg-transparent text-primary-700 hover:bg-primary-50 active:bg-primary-100",
  danger:
    "bg-danger-600 text-text-inverse hover:bg-danger-700 active:bg-danger-800",
};

/**
 * `sm` is still 44px tall.
 *
 * `docs/UI-UX/09` § Touch Target sets a 44x44px floor for interactive elements, and a
 * "small" button is exactly where that floor gets quietly broken. The size variants
 * differ in padding and horizontal presence, not in whether they can be tapped.
 */
const SIZE: Record<ButtonSize, string> = {
  sm: "px-3 text-body-sm gap-1.5",
  md: "px-4 text-button gap-2",
  lg: "px-6 text-body-lg gap-2",
};

/**
 * The button's classes, without the button.
 *
 * A navigation that looks like a button must be an `<a>`, not a `<button>` -- it goes
 * somewhere, so it belongs in the link list of a screen reader's rotor, it opens in a
 * new tab on middle-click, and it has an href a user can copy. Wrapping a `<Link>` in a
 * `<Button>` nests two interactive elements, which is invalid HTML and produces a
 * control whose announced role depends on which browser is asking.
 *
 * So: `<Link className={buttonClassName()}>`. The appearance comes from one place, and
 * the element stays honest about what it does.
 */
export function buttonClassName(
  options: {
    readonly variant?: ButtonVariant;
    readonly size?: ButtonSize;
    readonly className?: string;
  } = {},
): string {
  const { variant = "primary", size = "md", className } = options;

  return cx(
    "touch-target focus-ring inline-flex items-center justify-center rounded-md",
    "font-medium transition-colors select-none",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}
