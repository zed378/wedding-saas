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
import {
  forwardRef,
  useMemo,
  useState,
  type SelectHTMLAttributes,
} from "react";

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
import { Input } from "./Input.js";

/**
 * P0-22 — Select. `docs/UI-UX/06`: "single, searchable".
 *
 * ## Why this is a native `<select>`
 *
 * A custom listbox is the single most commonly broken widget on the web. Getting it
 * right means implementing the ARIA combobox pattern, typeahead, focus management, and
 * the behaviours every platform's screen reader expects — and then it still does not
 * match the OS picker a phone user knows. The native element is accessible, keyboard
 * navigable and touch-friendly on every platform for free.
 *
 * `docs/UI-UX/06` asks for a searchable variant. That is a real need for the template
 * catalogue and the timezone picker, and it is implemented as a **filter above a native
 * select** rather than as a custom popup: the text input narrows the option list and the
 * select stays a select. Less impressive, and it cannot be broken by a focus-management
 * bug in a modal.
 */

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean | undefined;
}

/**
 * `required` is omitted from the HTML attribute side and taken from `FieldOwnProps`.
 *
 * Both declare it, and with `exactOptionalPropertyTypes` the two are not *identical* --
 * one is `readonly`. TypeScript refuses an interface that extends two types disagreeing
 * on a member, which is the right refusal: the field wrapper uses `required` to render
 * the asterisk and the hidden "(wajib diisi)", and the control uses it as the HTML
 * attribute. One declaration means those two cannot drift apart.
 */
export interface SelectProps
  extends
    Omit<
      SelectHTMLAttributes<HTMLSelectElement>,
      "className" | "children" | "required"
    >,
    FieldOwnProps {
  readonly options: readonly SelectOption[];
  /** Adds a filter box above the list. `docs/UI-UX/06` § Core Components. */
  readonly searchable?: boolean | undefined;
  readonly searchLabel?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly selectClassName?: string | undefined;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      label,
      helperText,
      error,
      required,
      labelHidden,
      className,
      selectClassName,
      options,
      searchable = false,
      searchLabel = "Cari pilihan",
      placeholder,
      id: providedId,
      ...rest
    },
    ref,
  ) {
    const id = useFieldId(providedId);
    const { describedBy, invalid } = fieldWiring(id, helperText, error);
    const [query, setQuery] = useState("");

    const visible = useMemo(() => {
      if (!searchable || query.trim() === "") return options;
      const needle = query.trim().toLowerCase();
      return options.filter((o) => o.label.toLowerCase().includes(needle));
    }, [options, query, searchable]);

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
        {searchable && (
          <Input
            label={searchLabel}
            labelHidden
            type="search"
            value={query}
            placeholder={searchLabel}
            onChange={(e) => setQuery(e.target.value)}
            // The count is announced as it changes, so a keyboard user filtering a long
            // list is not typing into silence.
            helperText={`${visible.length} dari ${options.length} pilihan`}
          />
        )}

        <select
          {...rest}
          ref={ref}
          id={id}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cx(
            CONTROL_BASE,
            invalid ? CONTROL_BORDER_INVALID : CONTROL_BORDER,
            selectClassName,
          )}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {visible.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
      </Field>
    );
  },
);
