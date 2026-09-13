/**
 * `P2-18`, ADR-072 — how an event's date is shown: **`15 Mei 2027`**.
 *
 * `OQ-27`'s format half, answered by the project owner on 2026-09-13: *"only use 15 Mei 2027"* —
 * day, Indonesian month name, year. No weekday, no Hijri date, no leading zero on the day.
 *
 * ## A table, not `Intl`
 *
 * `Intl.DateTimeFormat("id-ID")` produces the same text in most places, but its output depends on
 * the ICU data of whatever runs it. The public invitation renders on the server and hydrates in
 * a guest's browser; a server and a browser with different locale data would render two strings
 * and React would replace the section. Twelve month names cannot disagree with themselves.
 *
 * ## Dates, not instants
 *
 * The stored value is a calendar date (`YYYY-MM-DD`). It is formatted from its own digits and never
 * turned into a `Date`, so no timezone can move it to the day before.
 *
 * Dependency-free, and exported on its own subpath (`@wi/schema/event-date`), so the renderer's
 * client components can import it without pulling in Zod (`P2-16`).
 */

const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

/**
 * `2027-05-15` → `15 Mei 2027`.
 *
 * Anything that is not a real calendar date in that shape is returned unchanged: showing a guest
 * the raw value is better than hiding it or inventing a different day.
 */
export function formatEventDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return value;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month))
    return value;

  return `${String(day)} ${MONTHS[month - 1]!} ${String(year)}`;
}

function daysIn(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
