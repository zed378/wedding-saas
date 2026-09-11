"use client";

/*
 * A client component.
 *
 * Next.js's App Router renders everything on the server by default, and a server
 * component cannot hold state, use a ref, or receive an event handler. This file does
 * one of those, so it declares the boundary itself rather than making every consumer
 * remember to -- `layout.tsx` importing `<ToastProvider>` would otherwise fail at build
 * time with an error about hooks that names the app, not the library.
 *
 * The purely presentational components in this package (Badge, Card, Skeleton, Avatar,
 * Stepper, Spinner) deliberately do NOT carry this directive: they render fine on the
 * server, and marking them would pull them into the client bundle for no reason.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cx } from "../cx.js";
import {
  buttonClassName,
  type ButtonSize,
  type ButtonVariant,
} from "./button-class.js";
import { Spinner } from "./Spinner.js";

/**
 * P0-22 — Button. `docs/UI-UX/06` § Core Components: "primary, secondary, ghost,
 * danger; size sm/md/lg; loading state".
 *
 * Every state from `docs/UI-UX/06` § Usage Rules is defined here and nowhere else:
 * default, hover, focus, active, disabled, loading. There is no `error` state for a
 * button — the error belongs to the thing the button submitted, and a red button that
 * means "this failed" is indistinguishable from a red button that means "this deletes".
 */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  /**
   * Renders a spinner and blocks the click.
   *
   * A loading button stays **focusable**: `aria-disabled` and a swallowed click, not the
   * `disabled` attribute. A disabled element loses focus, and a keyboard user who
   * pressed Enter on a submit button would be thrown back to the top of the document
   * with no idea what happened.
   */
  readonly loading?: boolean | undefined;
  /** Announced by a screen reader while `loading`. */
  readonly loadingLabel?: string | undefined;
  readonly leadingIcon?: ReactNode | undefined;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      loadingLabel = "Memuat",
      leadingIcon,
      className,
      children,
      disabled,
      onClick,
      type = "button",
      ...rest
    },
    ref,
  ) {
    const inert = loading || disabled === true;

    return (
      <button
        {...rest}
        ref={ref}
        type={type}
        // `disabled` only when genuinely disabled. See `loading` above.
        disabled={disabled}
        aria-disabled={inert || undefined}
        aria-busy={loading || undefined}
        onClick={(event) => {
          if (inert) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
        className={cx(
          buttonClassName({ variant, size }),
          // The disabled look is the same whatever the variant, so "cannot press this"
          // reads the same everywhere. Colour is not the only cue: the cursor changes
          // and aria-disabled is set (docs/UI-UX/08 § Contrast & Accessibility).
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
          className,
        )}
      >
        {loading ? (
          <>
            <Spinner className="size-4" />
            <span className="sr-only">{loadingLabel}</span>
          </>
        ) : (
          leadingIcon
        )}
        {children}
      </button>
    );
  },
);
