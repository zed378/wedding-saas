import type { ReactNode } from "react";

import { cx } from "../cx.js";

/**
 * P0-22 — the label, helper text and error message that every form control shares.
 *
 * It exists so that label association cannot be forgotten. `docs/UI-UX/17` requires
 * every input to have a programmatically associated label, and the way that breaks is
 * never a decision — it is a control added in a hurry with a `<div>` above it that
 * looks like a label. Input, Textarea, Select and Dropzone all render through this, so
 * there is one place where `htmlFor`, `aria-describedby` and `aria-invalid` are wired.
 *
 * ## The error is not just red
 *
 * `docs/UI-UX/08` § Contrast & Accessibility: "Color is NEVER the sole indicator of
 * information". An invalid field gets `aria-invalid`, a red border **and** a text
 * message in the accessibility tree via `aria-describedby`. Someone who cannot see the
 * border still hears why the field was rejected.
 */

export interface FieldOwnProps {
  readonly label: string;
  /** `docs/UI-UX/09`: 8px between label and control, 16–24px between fields. */
  readonly helperText?: string | undefined;
  readonly error?: string | undefined;
  readonly required?: boolean | undefined;
  /** Hides the label visually while keeping it for assistive technology. */
  readonly labelHidden?: boolean | undefined;
  readonly className?: string | undefined;
}

export interface FieldWiring {
  readonly id: string;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
}

/**
 * The ids a control needs so its label, helper text and error all reach it.
 *
 * Returns `describedBy` as a single string because `aria-describedby` takes a
 * space-separated list, and a control with both helper text and an error must announce
 * both — the helper says what is wanted and the error says what was wrong with the
 * attempt.
 */
export function fieldWiring(
  id: string,
  helperText: string | undefined,
  error: string | undefined,
): FieldWiring {
  const ids = [
    helperText === undefined ? undefined : `${id}-helper`,
    error === undefined ? undefined : `${id}-error`,
  ].filter((v): v is string => v !== undefined);

  return {
    id,
    describedBy: ids.length > 0 ? ids.join(" ") : undefined,
    invalid: error !== undefined,
  };
}

export function Field({
  id,
  label,
  helperText,
  error,
  required = false,
  labelHidden = false,
  className,
  children,
}: FieldOwnProps & { readonly id: string; readonly children: ReactNode }) {
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <label
        htmlFor={id}
        className={cx(
          "text-body font-medium text-text",
          labelHidden && "sr-only",
        )}
      >
        {label}
        {required && (
          <>
            {" "}
            <span className="text-danger-600" aria-hidden="true">
              *
            </span>
            {/* The asterisk is decoration; `required` on the control is the fact. This
                span makes it a fact for a screen reader too, without reading "asterisk". */}
            <span className="sr-only">(wajib diisi)</span>
          </>
        )}
      </label>

      {children}

      {helperText !== undefined && (
        <p id={`${id}-helper`} className="text-body-sm text-text-muted">
          {helperText}
        </p>
      )}

      {error !== undefined && (
        <p
          id={`${id}-error`}
          // `role="alert"` so a validation failure arriving after submit is announced
          // rather than sitting silently on screen.
          role="alert"
          className="text-body-sm font-medium text-danger-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The border and ring shared by every text-entry control.
 *
 * The disabled state changes the background and the text colour and does **not** use
 * `opacity`. WCAG exempts inactive controls from the contrast requirement, so an opacity
 * dim here would pass every audit -- but a disabled field still has to be readable,
 * because its value is often the reason the user is looking at it. The same reasoning,
 * and the same measured failure, is written up in `Dropzone.tsx`.
 */
export const CONTROL_BASE =
  "touch-target focus-ring w-full rounded-md border bg-surface-raised px-3 py-2 text-body text-text " +
  "placeholder:text-text-muted disabled:cursor-not-allowed disabled:bg-surface-sunken " +
  "disabled:text-text-muted";

export const CONTROL_BORDER = "border-border-strong";
export const CONTROL_BORDER_INVALID = "border-danger-600";
