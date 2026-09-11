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
import { useCallback, useRef, type ReactNode } from "react";

import { cx } from "../cx.js";
import { useFieldId } from "../useId.js";

/**
 * P0-22 — Tabs. `docs/UI-UX/06`: "for editor sub-section navigation".
 *
 * ## The keyboard behaviour is the component
 *
 * A row of buttons that swap a panel is easy. What makes it a tab list is the WAI-ARIA
 * pattern, and every part of it exists because a keyboard user expects it:
 *
 *   - **Arrow keys move between tabs**, Home and End jump to the ends. Tab does not:
 *     one press of Tab moves *out* of the tab list into the panel.
 *   - **Roving tabindex** — exactly one tab is in the tab order, the selected one. A
 *     list of ten tabs each reachable by Tab means ten presses to reach the content.
 *   - **The panel is labelled by its tab**, so a screen reader entering it says which
 *     section this is.
 *
 * The editor has a section list on the left (`docs/UI-UX/09` § Editor Layout) that
 * becomes tab-switching on mobile (`docs/UI-UX/12`, `15`). That is the case this has to
 * survive, and it is the case where a broken tab list strands someone.
 */

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
  readonly disabled?: boolean | undefined;
}

export interface TabsProps {
  readonly items: readonly TabItem[];
  readonly activeId: string;
  readonly onChange: (id: string) => void;
  /** The accessible name of the tab list itself, e.g. "Bagian undangan". */
  readonly label: string;
  readonly className?: string | undefined;
}

export function Tabs({
  items,
  activeId,
  onChange,
  label,
  className,
}: TabsProps) {
  const baseId = useFieldId();
  const listRef = useRef<HTMLDivElement>(null);

  /** Select a tab by its position among the ENABLED tabs, and move focus to it. */
  const activate = useCallback(
    (target: TabItem | undefined) => {
      if (target === undefined) return;

      onChange(target.id);
      listRef.current
        ?.querySelector<HTMLButtonElement>(
          `#${CSS.escape(`${baseId}-tab-${target.id}`)}`,
        )
        ?.focus();
    },
    [baseId, onChange],
  );

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    // Disabled tabs are skipped rather than landed on, so arrowing past one does not
    // strand the user on a control they cannot activate.
    const enabled = items.filter((item) => item.disabled !== true);
    if (enabled.length === 0) return;

    /**
     * Step relative to the current tab, wrapping.
     *
     * `position` is where the focused tab sits among the *enabled* ones. When the
     * focused tab is itself disabled it is not in that list, `findIndex` returns -1,
     * and stepping forward from -1 lands on the first enabled tab -- which is the right
     * answer for that case too.
     */
    const step = (delta: number): TabItem | undefined => {
      const position = enabled.findIndex((item) => item === items[index]);
      return enabled[(position + delta + enabled.length) % enabled.length];
    };

    const handlers: Record<string, () => void> = {
      // Wraps. A user holding the right arrow at the last tab expects the first, not a
      // dead key.
      ArrowRight: () => activate(step(1)),
      ArrowLeft: () => activate(step(-1)),
      // Home and End are absolute, not relative. Computing them as a step from an
      // out-of-range index is the kind of cleverness that produces "End goes to the
      // second tab", which is exactly what it produced.
      Home: () => activate(enabled[0]),
      End: () => activate(enabled[enabled.length - 1]),
    };

    const handler = handlers[event.key];
    if (handler === undefined) return;
    event.preventDefault();
    handler();
  };

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {items.map((item, index) => {
          const selected = item.id === activeId;
          return (
            <button
              key={item.id}
              id={`${baseId}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              // Roving tabindex: only the selected tab is in the tab order.
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => {
                onChange(item.id);
              }}
              onKeyDown={(event) => {
                onKeyDown(event, index);
              }}
              className={cx(
                "touch-target focus-ring -mb-px shrink-0 border-b-2 px-4 text-body font-medium",
                "disabled:cursor-not-allowed disabled:opacity-50",
                selected
                  ? "border-primary-600 text-primary-700"
                  : "border-transparent text-text-muted hover:border-border-strong hover:text-text",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {items.map((item) => (
        <div
          key={item.id}
          id={`${baseId}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== activeId}
          // The panel is focusable so Tab from the tab list lands somewhere meaningful
          // even when the panel's first element is not focusable.
          tabIndex={0}
          className="focus-ring pt-4"
        >
          {item.id === activeId && item.content}
        </div>
      ))}
    </div>
  );
}
