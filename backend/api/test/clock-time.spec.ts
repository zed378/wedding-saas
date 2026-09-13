import { describe, expect, it } from "vitest";

import { toClockTime } from "../src/shared/time/clock-time";

/** `P2-15` — event times leave the API in the shape it accepts. */
describe("toClockTime", () => {
  it.each([
    ["08:00:00", "08:00"],
    ["23:59:59", "23:59"],
    ["07:30:00.000", "07:30"],
    ["08:00", "08:00"],
  ])("serves %s as %s", (input, expected) => {
    expect(toClockTime(input)).toBe(expected);
  });

  it("passes null and undefined through", () => {
    expect(toClockTime(null)).toBeNull();
    expect(toClockTime(undefined)).toBeUndefined();
  });

  it("leaves anything it does not recognise alone rather than inventing a time", () => {
    expect(toClockTime("not a time")).toBe("not a time");
  });
});
