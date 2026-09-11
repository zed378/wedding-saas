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
import type { ReactNode } from "react";

import { cx } from "../cx.js";

/**
 * P0-22 — Table. `docs/UI-UX/06`: "order list, RSVP list, guestbook list — with
 * sorting/filtering".
 *
 * ## A real `<table>`
 *
 * Not a grid of divs. A screen reader in table mode lets someone move by row and column
 * and hear the header for the cell they land on; a div grid gives them a wall of
 * unrelated text. The RSVP list is the case that matters — a hundred rows of name,
 * attendance and party size, where "which column is this" is the whole question.
 *
 * ## Sorting announces itself
 *
 * `aria-sort` on the header cell, and the header is a **button** inside the `<th>`. A
 * clickable `<th>` is not focusable and not activatable by keyboard, which is how
 * sorting silently becomes mouse-only.
 */

export type SortDirection = "asc" | "desc";

export interface TableColumn<Row> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: Row) => ReactNode;
  /** Omit to make the column unsortable. */
  readonly sortable?: boolean | undefined;
  /** Right-align numeric columns. */
  readonly numeric?: boolean | undefined;
}

export interface TableProps<Row> {
  /** The accessible name. A table with no caption is a table nobody can identify. */
  readonly caption: string;
  readonly columns: readonly TableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly sort?: {
    readonly key: string | undefined;
    readonly direction: SortDirection;
  };
  readonly onSortChange?: (
    key: string,
    direction: SortDirection,
  ) => void | undefined;
  /** Shown in place of the body when there are no rows. */
  readonly empty?: ReactNode | undefined;
  readonly className?: string | undefined;
}

export function Table<Row>({
  caption,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  empty = "Belum ada data.",
  className,
}: TableProps<Row>) {
  return (
    // Horizontal scroll on a wrapper, not on the table, and focusable so a keyboard
    // user can scroll it. A scrollable region that cannot be focused is unreachable
    // without a mouse (WCAG 2.1 § 2.1.1).
    <div
      tabIndex={0}
      role="region"
      aria-label={caption}
      className={cx(
        "focus-ring overflow-x-auto rounded-lg border border-border",
        className,
      )}
    >
      <table className="w-full border-collapse text-body">
        <caption className="sr-only">{caption}</caption>

        <thead className="bg-surface-sunken">
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const direction: SortDirection =
                active && sort.direction === "asc" ? "desc" : "asc";

              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    column.sortable !== true
                      ? undefined
                      : active
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                  }
                  className={cx(
                    "border-b border-border px-4 py-3 text-body-sm font-semibold text-text",
                    column.numeric === true ? "text-right" : "text-left",
                  )}
                >
                  {column.sortable === true && onSortChange !== undefined ? (
                    <button
                      type="button"
                      onClick={() => {
                        onSortChange(column.key, direction);
                      }}
                      className="focus-ring inline-flex items-center gap-1 rounded-sm font-semibold hover:text-primary-700"
                    >
                      {column.header}
                      {/* The arrow is decoration; aria-sort above is the fact. */}
                      <span aria-hidden="true">
                        {active ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-body text-text-muted"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-border last:border-b-0 hover:bg-surface-sunken"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(
                      "px-4 py-3 text-text",
                      column.numeric === true && "text-right tabular-nums",
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
