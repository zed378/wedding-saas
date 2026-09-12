"use client";

import { Input, Select, Textarea } from "@wi/ui";

import type { FieldMeta } from "./registry";

/**
 * P1-23 step 3 — the reusable field components. `docs/FRONTEND/03` § Reusable Field Components.
 *
 * ## One dispatcher, nine controls, no section knowledge
 *
 * Nothing in this file knows what a `hero` is or that `couple.groom.nickname` exists. It is
 * handed a `FieldMeta` and a value and renders a control. That is what `CLAUDE.md`'s "don't
 * hard-code section/field logic per template" means in practice, and
 * `scripts/check-no-hardcoded-fields.mjs` fails the build if a path or a section key appears
 * as a literal in a component file — including this one.
 *
 * ## Photo and map are stubs, and say so
 *
 * `P1-24` builds the upload flow and the MapLibre picker. They are real controls here — they
 * hold a value, emit changes and are labelled — with the rich interaction still to come. A
 * placeholder that renders nothing would make the panel look finished while two field types
 * silently did not work.
 */

export interface FieldControlProps {
  readonly path: string;
  readonly meta: FieldMeta;
  readonly value: unknown;
  readonly required: boolean;
  readonly error?: string | undefined;
  readonly onChange: (value: unknown) => void;
}

export function FieldControl({
  path,
  meta,
  value,
  required,
  error,
  onChange,
}: FieldControlProps) {
  const common = {
    label: meta.label,
    required,
    ...(meta.helperText !== undefined ? { helperText: meta.helperText } : {}),
    ...(error !== undefined ? { error } : {}),
  };

  switch (meta.type) {
    case "textarea":
      return (
        <Textarea
          {...common}
          name={path}
          value={asText(value)}
          {...(meta.maxLength !== undefined
            ? { maxLength: meta.maxLength }
            : {})}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      );

    case "select":
      return (
        <Select
          {...common}
          name={path}
          value={asText(value)}
          options={[...(meta.options ?? [])]}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      );

    case "date":
      return (
        <Input
          {...common}
          type="date"
          name={path}
          value={asText(value)}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      );

    case "time":
      return (
        <Input
          {...common}
          type="time"
          name={path}
          value={asText(value)}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      );

    case "toggle":
      return (
        <label className="flex min-h-11 items-center gap-3 text-sm text-text">
          <input
            type="checkbox"
            name={path}
            className="focus-ring h-4 w-4"
            checked={value === true}
            onChange={(e) => {
              onChange(e.target.checked);
            }}
          />
          <span>{meta.label}</span>
          {error !== undefined && (
            <span className="text-danger-700">{error}</span>
          )}
        </label>
      );

    case "photo":
    case "photo-multi":
      return (
        <Input
          {...common}
          name={path}
          value={asText(value)}
          helperText={
            meta.helperText ??
            "Pengunggahan foto akan tersedia bersama pengelola media."
          }
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      );

    case "map-picker":
      return (
        <Input
          {...common}
          type="number"
          name={path}
          value={asText(value)}
          helperText={
            meta.helperText ??
            "Pemilih peta akan tersedia bersama pengelola media."
          }
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      );

    case "text":
    default:
      return (
        <Input
          {...common}
          name={path}
          value={asText(value)}
          {...(meta.maxLength !== undefined
            ? { maxLength: meta.maxLength }
            : {})}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      );
  }
}

/**
 * A controlled input needs a string, and the store holds `unknown`.
 *
 * `undefined` and `null` both become `""` rather than reaching React, which would otherwise
 * warn about a controlled input becoming uncontrolled and, worse, would lose the user's
 * cursor position on the first keystroke into an empty field.
 */
function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : String(value);
}
