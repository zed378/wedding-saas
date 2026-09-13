import { describe, expect, it } from "vitest";

import {
  isEventTimezone,
  timezoneAbbreviation,
  timezoneForCoordinates,
  timezoneForRegionCode,
  timezoneOffset,
} from "./event-timezone.js";

/**
 * `P2-16` — detecting an event's zone from its map pin.
 *
 * Real places, weighted toward the borders: the pairs either side of the Bali Strait, of the
 * Central/South Kalimantan line, of North Sulawesi and North Maluku, and of Alor and Wetar. A
 * rule that got a capital right and a border town wrong would put a countdown an hour out for
 * exactly the couples near the line.
 */
describe("timezoneForCoordinates", () => {
  it.each([
    // WIB
    ["Jakarta", -6.2, 106.82, "Asia/Jakarta"],
    ["Banda Aceh", 5.55, 95.32, "Asia/Jakarta"],
    ["Medan", 3.59, 98.67, "Asia/Jakarta"],
    ["Batam", 1.1, 104.0, "Asia/Jakarta"],
    ["Pangkalpinang", -2.13, 106.11, "Asia/Jakarta"],
    ["Manggar, Belitung", -2.87, 108.28, "Asia/Jakarta"],
    ["Ranai, Natuna", 3.94, 108.39, "Asia/Jakarta"],
    ["Semarang", -6.97, 110.42, "Asia/Jakarta"],
    ["Yogyakarta", -7.8, 110.37, "Asia/Jakarta"],
    ["Surabaya", -7.25, 112.75, "Asia/Jakarta"],
    ["Malang", -7.98, 112.63, "Asia/Jakarta"],
    ["Bawean", -5.8, 112.65, "Asia/Jakarta"],
    ["Kangean islands (East Java)", -6.95, 115.4, "Asia/Jakarta"],
    ["Banyuwangi (Bali Strait, Java side)", -8.22, 114.37, "Asia/Jakarta"],
    ["Pontianak", -0.03, 109.33, "Asia/Jakarta"],
    ["Putussibau", 0.84, 112.93, "Asia/Jakarta"],
    ["Palangka Raya", -2.21, 113.92, "Asia/Jakarta"],
    ["Sampit", -2.53, 112.97, "Asia/Jakarta"],
    ["Kuala Kapuas (Central Kalimantan)", -3.0, 114.39, "Asia/Jakarta"],
    ["Muara Teweh (Central Kalimantan)", -0.95, 114.89, "Asia/Jakarta"],
    // WITA
    ["Gilimanuk (Bali Strait, Bali side)", -8.17, 114.43, "Asia/Makassar"],
    ["Denpasar", -8.65, 115.22, "Asia/Makassar"],
    ["Singaraja", -8.11, 115.09, "Asia/Makassar"],
    ["Nusa Penida", -8.73, 115.5, "Asia/Makassar"],
    ["Mataram", -8.58, 116.12, "Asia/Makassar"],
    ["Labuan Bajo", -8.5, 119.9, "Asia/Makassar"],
    ["Kupang", -10.17, 123.6, "Asia/Makassar"],
    ["Kalabahi, Alor", -8.22, 124.52, "Asia/Makassar"],
    ["Banjarmasin (South Kalimantan)", -3.32, 114.59, "Asia/Makassar"],
    ["Balikpapan", -1.24, 116.83, "Asia/Makassar"],
    ["Samarinda", -0.5, 117.15, "Asia/Makassar"],
    ["Tarakan", 3.3, 117.6, "Asia/Makassar"],
    ["Long Apari (Mahakam Ulu)", 0.9, 114.2, "Asia/Makassar"],
    ["Makassar", -5.12, 119.43, "Asia/Makassar"],
    ["Wangi-Wangi, Wakatobi", -5.3, 123.6, "Asia/Makassar"],
    ["Luwuk", -0.95, 122.79, "Asia/Makassar"],
    ["Manado", 1.47, 124.84, "Asia/Makassar"],
    ["Melonguane, Talaud", 4.02, 126.77, "Asia/Makassar"],
    // WIT
    ["Ternate", 0.79, 127.38, "Asia/Jayapura"],
    ["Morotai", 2.3, 128.3, "Asia/Jayapura"],
    ["Sanana, Sula", -2.06, 125.97, "Asia/Jayapura"],
    ["Ambon", -3.7, 128.18, "Asia/Jayapura"],
    ["Ilwaki, Wetar", -7.9, 126.3, "Asia/Jayapura"],
    ["Saumlaki, Tanimbar", -7.97, 131.3, "Asia/Jayapura"],
    ["Sorong", -0.88, 131.25, "Asia/Jayapura"],
    ["Jayapura", -2.53, 140.7, "Asia/Jayapura"],
    ["Merauke", -8.5, 140.4, "Asia/Jayapura"],
  ] as const)("%s is %s", (_place, latitude, longitude, zone) => {
    expect(timezoneForCoordinates(latitude, longitude)).toBe(zone);
  });

  // Only far outside the archipelago's bounding box. A pin in Kuala Lumpur or Singapore gets
  // a zone: excluding them would also drop Sumatran towns on the Malacca Strait, and the
  // couple can change the field. Documented on the function.
  it.each([
    ["Darwin", -12.46, 130.84],
    ["Bangkok", 13.75, 100.5],
    ["not a number", Number.NaN, 106.8],
  ])("does not guess for %s", (_place, latitude, longitude) => {
    expect(timezoneForCoordinates(latitude, longitude)).toBeUndefined();
  });
});

describe("timezoneForRegionCode", () => {
  it.each([
    ["31.71", "Asia/Jakarta"], // Kota Jakarta Pusat
    ["62.71", "Asia/Jakarta"], // Kota Palangka Raya
    ["51.71.01.1001", "Asia/Makassar"], // a kelurahan in Denpasar
    ["63.71", "Asia/Makassar"], // Kota Banjarmasin
    ["82.71", "Asia/Jayapura"], // Kota Ternate
    ["96", "Asia/Jayapura"], // Papua Barat Daya, one of the 2022 provinces
  ])("%s is %s", (code, zone) => {
    expect(timezoneForRegionCode(code)).toBe(zone);
  });

  it("covers exactly the 38 provinces", () => {
    const provinces = Array.from({ length: 100 }, (_, i) =>
      String(i).padStart(2, "0"),
    ).filter((code) => timezoneForRegionCode(code) !== undefined);
    expect(provinces).toHaveLength(38);
  });
});

describe("the zones", () => {
  it("are fixed offsets with the abbreviations guests read", () => {
    expect(timezoneAbbreviation("Asia/Makassar")).toBe("WITA");
    expect(timezoneOffset("Asia/Jayapura")).toBe("+09:00");
  });

  it("fall back to WIB for anything unrecognised, as before P2-16", () => {
    expect(timezoneAbbreviation(undefined)).toBe("WIB");
    expect(timezoneOffset("Europe/London")).toBe("+07:00");
    expect(isEventTimezone("Europe/London")).toBe(false);
  });
});
