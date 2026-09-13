import { describe, expect, it } from "vitest";

import { formatEventDate } from "./event-date.js";

/** `P2-18` — the owner's format: `15 Mei 2027`. */
describe("formatEventDate", () => {
  it.each([
    ["2027-05-15", "15 Mei 2027"],
    ["2027-01-01", "1 Januari 2027"],
    ["2027-02-09", "9 Februari 2027"],
    ["2027-03-31", "31 Maret 2027"],
    ["2027-04-30", "30 April 2027"],
    ["2027-06-12", "12 Juni 2027"],
    ["2027-07-04", "4 Juli 2027"],
    ["2027-08-17", "17 Agustus 2027"],
    ["2027-09-01", "1 September 2027"],
    ["2027-10-10", "10 Oktober 2027"],
    ["2027-11-11", "11 November 2027"],
    ["2027-12-25", "25 Desember 2027"],
    ["2028-02-29", "29 Februari 2028"],
  ])("shows %s as %s", (input, expected) => {
    expect(formatEventDate(input)).toBe(expected);
  });

  it("has no weekday and no leading zero", () => {
    const shown = formatEventDate("2027-05-05");
    expect(shown).toBe("5 Mei 2027");
    expect(shown).not.toMatch(/Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu/);
  });

  it.each([
    "2027-02-29",
    "2027-13-01",
    "2027-04-31",
    "15-05-2027",
    "2027-5-15",
    "",
  ])("leaves %s unchanged rather than inventing a date", (input) => {
    expect(formatEventDate(input)).toBe(input);
  });
});
