import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  collectMissingRequiredFields,
  type SectionDefinition,
} from "@wi/schema";
import { describe, expect, it } from "vitest";

import { toCompletenessDocument } from "../src/modules/invitation/completeness-document";
import type {
  InvitationAggregate,
  InvitationRow,
} from "../src/shared/tenancy/invitation-repository";

/**
 * `P3-09` — BR-4.2 completeness resolves a template's canonical paths against the canonical document.
 *
 * The regression this guards: the checks used the editor API's DTO (`event_date`, `bank_accounts`, a flat
 * `gallery`), so `events.*.date`, `gift.accounts.*` and `gallery.photos` were missing for every invitation
 * and nothing on the reference template could be published. The test that matters is the first one — a
 * fully filled invitation must satisfy EVERY requirement of the real reference template, section by section.
 */

const reference = JSON.parse(
  readFileSync(
    join(
      __dirname,
      "..",
      "src",
      "infra",
      "db",
      "seed-data",
      "reference-template.json",
    ),
    "utf8",
  ),
) as { sections: (SectionDefinition & Record<string, unknown>)[] };

const sections = reference.sections.map(
  (section) =>
    Object.fromEntries(
      Object.entries(section).filter(([key]) => !key.startsWith("_")),
    ) as unknown as SectionDefinition,
);
const allKeys = sections.map((s) => s.section_key);

const row = { slug: "budi-dan-siti" } as InvitationRow;

const person = (role: string, name: string) => ({
  role,
  fullName: `${name} Lengkap`,
  nickname: name,
  instagram: null,
  fatherName: null,
  motherName: null,
  childOrder: null,
  photoMediaId: "11111111-1111-4111-8111-111111111111",
});

function filled(): InvitationAggregate {
  return {
    people: [person("groom", "Budi"), person("bride", "Siti")],
    events: [
      {
        type: "akad",
        title: "Akad Nikah",
        eventDate: "2027-05-15",
        startTime: "08:00:00",
        endTime: null,
        timezone: "Asia/Jakarta",
        venueName: "Masjid Agung",
        address: "Jalan Merdeka 1",
        latitude: null,
        longitude: null,
        mapsUrl: null,
        description: null,
        displayOrder: 0,
      },
    ],
    gallery: [
      {
        mediaId: "22222222-2222-4222-8222-222222222222",
        caption: null,
        isCover: true,
        displayOrder: 0,
      },
    ],
    bankAccounts: [
      {
        type: "bank",
        providerName: "BCA",
        accountNumber: "1234567890",
        accountHolder: "Budi",
        displayOrder: 0,
      },
    ],
    quote: { text: "Ar-Rum 21", source: null },
    settings: {
      enabledSections: allKeys,
      rsvpEnabled: true,
      guestbookEnabled: true,
    },
  } as unknown as InvitationAggregate;
}

describe("toCompletenessDocument", () => {
  it("satisfies every required field of the reference template when everything is filled in", () => {
    const missing = collectMissingRequiredFields(
      sections,
      allKeys,
      toCompletenessDocument(row, filled()),
    );
    expect(missing).toEqual([]);
  });

  it.each([
    ["events.*.date", (a: InvitationAggregate) => ({ ...a, events: [] })],
    [
      "gift.accounts.*.account_number",
      (a: InvitationAggregate) => ({ ...a, bankAccounts: [] }),
    ],
    ["gallery.photos", (a: InvitationAggregate) => ({ ...a, gallery: [] })],
    ["quote.text", (a: InvitationAggregate) => ({ ...a, quote: null })],
    [
      "couple.bride.nickname",
      (a: InvitationAggregate) => ({
        ...a,
        people: a.people.map((p) =>
          p.role === "bride" ? { ...p, nickname: "" } : p,
        ),
      }),
    ],
  ])("reports %s when that data is absent", (path, strip) => {
    const document = toCompletenessDocument(
      row,
      strip(filled()) as InvitationAggregate,
    );
    const missing = collectMissingRequiredFields(
      sections,
      allKeys,
      document,
    ).map((m) => m.path);
    expect(missing).toContain(path);
  });

  it("uses canonical names, never the editor API's", () => {
    const document = JSON.stringify(toCompletenessDocument(row, filled()));
    expect(document).toContain('"date":"2027-05-15"');
    expect(document).not.toContain("event_date");
    expect(document).not.toContain("bank_accounts");
  });
});
