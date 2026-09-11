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
import { useRef, useState, type DragEvent } from "react";

import { cx } from "../cx.js";
import { useFieldId } from "../useId.js";
import { Field, fieldWiring } from "./Field.js";

/**
 * P0-22 — Dropzone. `docs/UI-UX/06`: "File Upload/Dropzone — with a progress bar".
 *
 * ## Drag-and-drop is the enhancement, not the control
 *
 * There is a real `<input type="file">` underneath, and the visible zone is its
 * `<label>`. That single decision gives keyboard operation, the OS file picker, screen
 * reader support and mobile camera access for nothing — and it is why the component
 * cannot be broken into a mouse-only control by a later refactor. Drag-and-drop is
 * layered on top.
 *
 * ## What this does NOT do
 *
 * It does not validate the file. `docs/SECURITY/06` requires a magic-byte check, EXIF
 * stripping, decompression-bomb protection and a malware scan, **all server-side**, and
 * `accept` here is a convenience for the file picker rather than a control. A client
 * that trusted this would be trusting an attribute the attacker controls.
 *
 * The `accept` list and `maxSizeBytes` are shown to the user so the constraint is
 * visible before they pick a 40MB RAW file — that is their whole job.
 */

export interface DropzoneProps {
  readonly label: string;
  readonly helperText?: string | undefined;
  readonly error?: string | undefined;
  readonly accept?: string | undefined;
  readonly multiple?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly onFiles: (files: readonly File[]) => void;
  /** 0–100. Renders a progress bar when defined. */
  readonly progress?: number | undefined;
  readonly className?: string | undefined;
  readonly id?: string | undefined;
}

export function Dropzone({
  label,
  helperText,
  error,
  accept,
  multiple = false,
  disabled = false,
  onFiles,
  progress,
  className,
  id: providedId,
}: DropzoneProps) {
  const id = useFieldId(providedId);
  const { describedBy, invalid } = fieldWiring(id, helperText, error);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accepted = (list: FileList | null) => {
    if (list === null || list.length === 0) return;
    onFiles(Array.from(list));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    accepted(event.dataTransfer.files);
  };

  return (
    <Field
      id={id}
      label={label}
      helperText={helperText}
      error={error}
      className={className}
    >
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={onDrop}
        className={cx(
          "rounded-lg border-2 border-dashed p-6 text-center transition-colors",
          // `focus-within` rather than `focus`: the focus is on the hidden input, and
          // without this the keyboard user sees no indicator at all.
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-focus)]",
          // Disabled is expressed with explicit colours, NOT with `opacity`.
          //
          // The browser axe pass caught this: `opacity-60` over the sunken surface
          // blends #171717 to #727272 on #f7f7f7, which is 4.49:1 -- one hundredth
          // below the 4.5:1 docs/UI-UX/08 requires. WCAG does exempt "inactive user
          // interface components" from contrast, and that exemption is why a disabled
          // <button> passes; it does not apply here, because the opacity sits on a
          // wrapper <div> and the text inside is not itself a disabled control.
          //
          // Opacity-based disabled states are unpredictable for exactly this reason:
          // the resulting colour is a blend nobody chose and no token test can check.
          // Chosen colours can be measured, and are -- see tokens.spec.ts.
          disabled && "cursor-not-allowed",
          invalid
            ? "border-danger-600 bg-danger-50"
            : dragging
              ? "border-primary-600 bg-primary-50"
              : "border-border-strong bg-surface-sunken",
        )}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => {
            accepted(event.target.files);
          }}
          // Visually hidden, NOT `display: none`. A `display: none` input is removed
          // from the accessibility tree and cannot be focused, which would make the
          // whole control mouse-only.
          className="sr-only"
        />

        <p
          className={cx(
            "text-body",
            disabled ? "text-text-muted" : "text-text",
          )}
        >
          <span
            className={cx(
              "font-medium",
              disabled ? "text-text-muted" : "text-primary-700",
            )}
          >
            Pilih berkas
          </span>{" "}
          atau seret ke sini
        </p>

        {accept !== undefined && (
          <p className="mt-1 text-body-sm text-text-muted">{accept}</p>
        )}
      </div>

      {progress !== undefined && (
        <div
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Mengunggah ${label}`}
          className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
        >
          <div
            className="h-full bg-primary-600 transition-[width]"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </Field>
  );
}
