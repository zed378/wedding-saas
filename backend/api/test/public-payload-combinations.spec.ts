import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { toPublicInvitation } from "../src/modules/publishing/public-invitation.dto";
import type { PublishedInvitation } from "../src/shared/tenancy/public-invitation-repository";

/**
 * `P2-14` step 1, the API half — a disabled section's data is absent from the public payload,
 * for **every** `enabled_sections` combination of the reference template.
 *
 * `public-invitation.itest.ts` proves the rule per section against the real database (one
 * section off at a time, and the shared-path case). This proves it across all 256 subsets of
 * the reference template's configurable sections, through the same pure function the endpoint
 * calls, against `docs/API/08`'s statement of the rule: data is served exactly when a
 * **displayed** section declares a field path under it.
 */

interface Section {
  section_key: string;
  configurable: boolean;
  required_fields: string[];
  optional_fields?: string[];
}

const reference = JSON.parse(
  readFileSync(
    join(__dirname, "../src/infra/db/seed-data/reference-template.json"),
    "utf8",
  ),
) as { sections: Section[]; theme: unknown; customizable_theme_keys: string[] };

const person = (role: string, name: string) => ({
  role,
  fullName: `${name} Lengkap`,
  nickname: name,
  instagram: null,
  fatherName: null,
  motherName: null,
  childOrder: null,
  photoMediaId: null,
});

function found(enabledSections: string[]): PublishedInvitation {
  return {
    invitation: { id: "inv-1", slug: "uji", status: "published" },
    aggregate: {
      people: [person("groom", "Budi"), person("bride", "Siti")],
      events: [
        {
          id: "e1",
          type: "akad",
          title: "Akad Nikah",
          eventDate: "2027-05-15",
          startTime: "08:00:00",
          endTime: null,
          venueName: "Masjid Agung",
          address: "Jl. Asia Afrika 1",
          latitude: null,
          longitude: null,
          mapsUrl: null,
          description: null,
          displayOrder: 0,
        },
      ],
      gallery: [],
      bankAccounts: [
        {
          id: "b1",
          type: "bank",
          providerName: "BCA",
          accountNumber: "8801234567",
          accountHolder: "Budi",
          displayOrder: 0,
        },
      ],
      quote: { text: "Sebuah kutipan", source: null },
      settings: {
        enabledSections,
        themeOverride: {},
        rsvpEnabled: true,
        guestbookEnabled: true,
        seoIndexable: false,
      },
    },
    gallery: [
      {
        photo: { caption: null, isCover: true, displayOrder: 0 },
        media: {
          // Real uuids: storage paths validate every component (docs/ARCHITECTURE/05).
          id: "5f0c1a8e-3b8d-4c52-9a6f-0b7a4f3e2d11",
          invitationId: "8a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
          status: "ready",
          width: 1600,
          height: 2000,
        },
      },
    ],
    personPhotos: new Map(),
    template: {
      sections: reference.sections,
      theme: reference.theme,
      customizableThemeKeys: reference.customizable_theme_keys,
      thumbnailUrl: null,
    },
    watermark: false,
  } as unknown as PublishedInvitation;
}

describe("every enabled_sections combination of the reference template, in the public payload", () => {
  const configurable = reference.sections
    .filter((s) => s.configurable)
    .map((s) => s.section_key);

  it("has something to combine", () => {
    expect(configurable.length).toBeGreaterThanOrEqual(5);
  });

  it(`serves a section's data exactly when a displayed section declares it, for all ${String(2 ** configurable.length)} subsets`, () => {
    const failures: string[] = [];

    for (let mask = 0; mask < 2 ** configurable.length; mask += 1) {
      const chosen = configurable.filter((_, index) => (mask >> index) & 1);
      const displayed = reference.sections.filter(
        (s) => !s.configurable || chosen.includes(s.section_key),
      );
      const declared = displayed.flatMap((s) => [
        ...s.required_fields,
        ...(s.optional_fields ?? []),
      ]);
      const referenced = (prefix: string) =>
        declared.some(
          (path) => path === prefix || path.startsWith(`${prefix}.`),
        );

      const payload = toPublicInvitation(found(chosen), "https://cdn.test")
        .invitation as unknown as Record<string, unknown>;
      const json = JSON.stringify(payload);

      const checks: [string, boolean, boolean][] = [
        ["gift", referenced("gift"), "gift" in payload],
        [
          "gift account number",
          referenced("gift"),
          json.includes("8801234567"),
        ],
        ["quote", referenced("quote"), json.includes("Sebuah kutipan")],
        [
          "events",
          referenced("events"),
          (payload["events"] as unknown[]).length > 0,
        ],
        [
          "groom",
          referenced("couple.groom"),
          (payload["couple"] as { groom: unknown }).groom !== null,
        ],
        [
          "gallery",
          referenced("gallery"),
          (payload["gallery"] as { photos: unknown[] }).photos.length > 0,
        ],
      ];

      for (const [what, expected, actual] of checks) {
        if (expected !== actual) {
          failures.push(
            `[${chosen.join(",")}] ${what}: expected ${expected ? "served" : "absent"}`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("actually toggles something across the combinations", () => {
    // Negative control: if every section's data were always referenced by a structural
    // section, the loop above would compare "served" with "served" 256 times.
    const off = toPublicInvitation(found([]), "https://cdn.test").invitation;
    const on = toPublicInvitation(
      found(configurable),
      "https://cdn.test",
    ).invitation;
    expect("gift" in off).toBe(false);
    expect("gift" in on).toBe(true);
    expect(JSON.stringify(off)).not.toContain("Sebuah kutipan");
    expect(JSON.stringify(on)).toContain("Sebuah kutipan");
  });
});
