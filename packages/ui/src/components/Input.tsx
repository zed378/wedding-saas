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
import { forwardRef, type InputHTMLAttributes } from "react";

import { cx } from "../cx.js";
import { useFieldId } from "../useId.js";
import {
  CONTROL_BASE,
  CONTROL_BORDER,
  CONTROL_BORDER_INVALID,
  Field,
  fieldWiring,
  type FieldOwnProps,
} from "./Field.js";

/**
 * P0-22 — Input. `docs/UI-UX/06`: "default, error, disabled; with label & helper text".
 *
 * The label is a required prop, not an optional one. A control that can be built
 * without a label is a control that will be, and `docs/UI-UX/17` has no exception for
 * "it is obvious from context" — context is exactly what a screen reader does not have.
 * Use `labelHidden` when the design has no room for it.
 */
/**
 * `required` is omitted from the HTML attribute side and taken from `FieldOwnProps`.
 *
 * Both declare it, and with `exactOptionalPropertyTypes` the two are not *identical* --
 * one is `readonly`. TypeScript refuses an interface that extends two types disagreeing
 * on a member, which is the right refusal: the field wrapper uses `required` to render
 * the asterisk and the hidden "(wajib diisi)", and the control uses it as the HTML
 * attribute. One declaration means those two cannot drift apart.
 */
export interface InputProps
  extends
    Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "required">,
    FieldOwnProps {
  readonly inputClassName?: string | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    helperText,
    error,
    required,
    labelHidden,
    className,
    inputClassName,
    id: providedId,
    ...rest
  },
  ref,
) {
  const id = useFieldId(providedId);
  const { describedBy, invalid } = fieldWiring(id, helperText, error);

  return (
    <Field
      id={id}
      label={label}
      helperText={helperText}
      error={error}
      required={required}
      labelHidden={labelHidden}
      className={className}
    >
      <input
        {...rest}
        ref={ref}
        id={id}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cx(
          CONTROL_BASE,
          invalid ? CONTROL_BORDER_INVALID : CONTROL_BORDER,
          inputClassName,
        )}
      />
    </Field>
  );
});
