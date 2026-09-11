"use client";

import { cx } from "../cx.js";
import type { CardProps } from "./Card.js";

/*
 * Split out of `Card.tsx` rather than marking that whole file as a client component.
 *
 * `Card` and `CardHeader` are pure markup and render on the server; this one takes an
 * event handler and cannot. Keeping them in one file would have pulled both into the
 * client bundle to serve one of them.
 */

export interface InteractiveCardProps extends CardProps {
  readonly onClick: () => void;
  /** The accessible name for the whole card. */
  readonly label: string;
}

/**
 * A card the user can activate.
 *
 * A real `<button>`, so it is focusable, has a role, and responds to Enter and Space
 * without a key handler. The visible content is `aria-hidden` from the accessible name
 * computation only insofar as `label` overrides it -- a template card whose name would
 * otherwise be read as "Elegant Rose modern floral Rp 139.000 Pilih" gets a name that
 * says what activating it does.
 */
export function InteractiveCard({
  children,
  className,
  padded = true,
  onClick,
  label,
}: InteractiveCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cx(
        "focus-ring block w-full rounded-lg border border-border bg-surface-raised text-left shadow-sm",
        "transition-shadow hover:shadow-md active:shadow-sm",
        padded && "p-6",
        className,
      )}
    >
      {children}
    </button>
  );
}
