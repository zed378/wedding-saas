"use client";

import { useId, useState } from "react";
import {
  collectMissingRequiredFields,
  describeMissingField,
  type SectionDefinition,
} from "@wi/schema";

import { useEditor } from "./EditorProvider";

/**
 * P2-06 steps 4 and 5 — the publish button, and what is left before it works.
 *
 * ## Visible and disabled, never hidden
 *
 * `docs/UI-UX/12` § Publish CTA, in its own words: *"disabled with a tooltip explaining
 * why if a required field is empty (not hidden — the user should always know the button
 * exists and understand why they can't click it yet)."*
 *
 * A hidden button is the worse failure of the two. A user who cannot find it does not
 * conclude their invitation is incomplete; they conclude the product cannot publish, or
 * that they are on the wrong screen.
 *
 * ## Evaluated here, decided by the server
 *
 * `docs/FRONTEND/03` § Validation: the client computes for immediacy and the server is
 * authoritative. This runs `collectMissingRequiredFields` — **the same function the
 * publish check runs** (`P0-20`, shared through `@wi/schema`) — against local editor
 * state, so the list updates as the couple types rather than after a round trip.
 *
 * It is deliberately not a second implementation of the rule. The one thing a client-side
 * copy must never do is disagree with the server about what is complete, and the only
 * reliable way to guarantee that is to run the same code.
 *
 * ## The disabled button still explains itself
 *
 * `aria-describedby` points at the list, so a screen-reader user who lands on the button
 * hears why it is disabled. A `title` tooltip alone is invisible to them and to anyone on
 * a touch screen, which is most of this product's users.
 */
export function PublishCta() {
  const definition = useEditor((state) => state.templateDefinition);
  const data = useEditor((state) => state.data);
  const [open, setOpen] = useState(false);
  const listId = useId();

  if (definition === undefined) return null;

  const missing = collectMissingRequiredFields(
    definition.sections as readonly SectionDefinition[],
    definition.enabledSections,
    data,
  );

  const ready = missing.length === 0;

  return (
    <div className="flex items-center gap-2">
      {!ready && (
        <button
          type="button"
          className="focus-ring rounded-md px-2 py-1 text-sm text-text-muted underline"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          {missing.length} isian belum lengkap
        </button>
      )}

      <button
        type="button"
        disabled={!ready}
        // Not `aria-disabled`: this button genuinely must not be activatable, and a real
        // `disabled` is what keeps it out of the tab order of a form the user cannot
        // submit. The explanation below is what replaces the affordance.
        {...(ready ? {} : { "aria-describedby": listId })}
        title={
          ready
            ? undefined
            : "Lengkapi isian yang wajib diisi sebelum menerbitkan undangan."
        }
        className="focus-ring min-h-9 rounded-md bg-primary-600 px-4 text-sm font-medium text-text-inverse disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-muted"
      >
        Terbitkan
      </button>

      {!ready && (
        <ul
          id={listId}
          // Present in the accessibility tree whether or not it is shown, because
          // `aria-describedby` has to be able to reach it. `hidden` would remove it.
          className={
            open
              ? "absolute top-14 right-4 z-50 max-w-sm rounded-md border border-border bg-surface p-3 text-sm shadow-md"
              : "sr-only"
          }
        >
          {missing.map((item) => (
            <li key={`${item.sectionKey}-${item.path}`}>
              {/*
               * The label, never the path. The card's DoD: "field paths never reach the
               * user interface untranslated" -- `couple.bride.nickname` tells a couple
               * nothing about what to go and fill in.
               */}
              {describeMissingField(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
