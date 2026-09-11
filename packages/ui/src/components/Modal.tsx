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
import { useEffect, useRef, type ReactNode } from "react";

import { cx } from "../cx.js";
import { useFieldId } from "../useId.js";

/**
 * P0-22 — Modal. `docs/UI-UX/06`: "confirmation, form, fullscreen (preview)".
 *
 * ## Built on `<dialog>`
 *
 * The browser's own element, because it gives four things correctly that a `<div>` with
 * `role="dialog"` has to reimplement and usually gets wrong:
 *
 *   1. **Focus is trapped.** Tab cannot escape to the page behind. Hand-rolled traps
 *      miss shadow DOM, iframes, and the browser's own address bar.
 *   2. **The rest of the page is inert.** Not merely covered — actually unreachable by
 *      keyboard and by a screen reader's virtual cursor.
 *   3. **Escape closes it.** Without a key handler that has to be removed on unmount.
 *   4. **It renders in the top layer**, above every stacking context, so no `z-index`
 *      arms race with a sticky header.
 *
 * The `cancel` event is what Escape fires; intercepting it is how a form modal can warn
 * about unsaved work.
 */

export type ModalSize = "confirmation" | "form" | "fullscreen";

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string | undefined;
  readonly size?: ModalSize | undefined;
  readonly children?: ReactNode | undefined;
  readonly footer?: ReactNode | undefined;
  /**
   * Whether clicking the backdrop closes it.
   *
   * Off for `form`, because losing a half-filled form to a stray click is the kind of
   * thing people remember about a product.
   */
  readonly dismissOnBackdrop?: boolean | undefined;
  readonly closeLabel?: string | undefined;
}

const SIZE: Record<ModalSize, string> = {
  confirmation: "max-w-md",
  form: "max-w-2xl",
  fullscreen: "max-w-none w-[calc(100vw-2rem)] h-[calc(100vh-2rem)]",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "confirmation",
  children,
  footer,
  dismissOnBackdrop = size !== "form",
  closeLabel = "Tutup",
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useFieldId();
  const descriptionId = useFieldId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    // `showModal()` rather than `show()` — `show()` gives a non-modal dialog with none
    // of the four properties above.
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onCancel={(event) => {
        // Escape. Prevented and routed through onClose so the parent decides, rather
        // than the dialog closing itself and the parent's `open` going stale.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (!dismissOnBackdrop) return;
        // A click on the dialog element itself is a click on the backdrop: the content
        // is inside a child, so anything landing here missed it.
        if (event.target === ref.current) onClose();
      }}
      className={cx(
        "m-auto w-full rounded-lg bg-surface-raised p-0 text-text shadow-lg",
        "backdrop:bg-neutral-900/50",
        SIZE[size],
      )}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-h3 font-semibold">
              {title}
            </h2>
            {description !== undefined && (
              <p id={descriptionId} className="text-body text-text-muted">
                {description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="touch-target focus-ring -m-2 rounded-md px-2 text-text-muted hover:bg-surface-sunken hover:text-text"
          >
            {/* The X is decoration; the accessible name is a word. */}
            <span aria-hidden="true">×</span>
            <span className="sr-only">{closeLabel}</span>
          </button>
        </div>

        {children !== undefined && <div className="text-body">{children}</div>}

        {footer !== undefined && (
          <div className="flex flex-wrap justify-end gap-3">{footer}</div>
        )}
      </div>
    </dialog>
  );
}
