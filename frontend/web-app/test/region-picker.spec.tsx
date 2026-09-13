import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ApiClient, accessTokenStore } from "@wi/api-client";

import { AuthProvider } from "../src/lib/auth";
import { EditorProvider } from "../src/editor/EditorProvider";
import { PropertiesPanel } from "../src/editor/PropertiesPanel";
import { selectedChain } from "../src/editor/fields/RegionPicker";
import type { TemplateDefinition } from "../src/editor/store";
import { toEditorDocument } from "../src/editor/transport";

/**
 * `P2-17` — choosing an event's region in the editor, and what it does to the zone.
 * `MEMORY/specs/P2-17-regions.md` § 12.
 */

const EVENT_ID = "11111111-1111-4111-8111-111111111111";

const REGIONS: Record<
  string,
  {
    code: string;
    name: string;
    kind: string;
    level: number;
    timezone?: string;
  }[]
> = {
  root: [
    {
      code: "32",
      name: "Jawa Barat",
      kind: "provinsi",
      level: 1,
      timezone: "Asia/Jakarta",
    },
    {
      code: "51",
      name: "Bali",
      kind: "provinsi",
      level: 1,
      timezone: "Asia/Makassar",
    },
  ],
  "51": [
    {
      code: "51.03",
      name: "Kabupaten Badung",
      kind: "kabupaten",
      level: 2,
      timezone: "Asia/Makassar",
    },
    {
      code: "51.71",
      name: "Kota Denpasar",
      kind: "kota",
      level: 2,
      timezone: "Asia/Makassar",
    },
  ],
  "51.71": [
    { code: "51.71.01", name: "Denpasar Selatan", kind: "kecamatan", level: 3 },
  ],
  "51.71.01": [
    { code: "51.71.01.1001", name: "Sesetan", kind: "kelurahan", level: 4 },
  ],
  "51.71.01.1001": [],
  "32": [],
};

const DEFINITION: TemplateDefinition = {
  sections: [
    {
      section_key: "event",
      component: "EventCardDouble",
      configurable: false,
      enabled_by_default: true,
      required_fields: ["events.*.title", "events.*.start_time"],
      optional_fields: [
        "events.*.timezone",
        "events.*.region_code",
        "events.*.latitude",
        "events.*.longitude",
      ],
    },
  ],
  enabledSections: ["event"],
};

function renderEditor(regionCode: string | null = null) {
  const saved: { key: string; fields: string[] }[] = [];
  const located: string[] = [];

  const client = new ApiClient({
    baseUrl: "http://api.test/api/v1",
    tokenStore: accessTokenStore,
    fetch: async (input) => {
      const url = new URL(String(input));
      const json = (data: unknown, status = 200) =>
        new Response(
          JSON.stringify(
            status === 200
              ? { success: true, data }
              : { success: false, error: { code: "NOT_FOUND", message: "-" } },
          ),
          {
            status,
            headers: { "content-type": "application/json" },
          },
        );
      if (url.pathname.endsWith("/regions/locate")) {
        located.push(
          `${url.searchParams.get("latitude")},${url.searchParams.get("longitude")}`,
        );
        return json({
          province: REGIONS["root"]![1],
          regency: REGIONS["51"]![0],
          timezone: "Asia/Makassar",
        });
      }
      if (url.pathname.endsWith("/regions")) {
        return json(REGIONS[url.searchParams.get("parent") ?? "root"] ?? []);
      }
      return json({});
    },
  });

  render(
    <AuthProvider client={client} restoreSession={false}>
      <EditorProvider
        invitationId="inv-1"
        data={toEditorDocument({
          events: [
            {
              id: EVENT_ID,
              type: "akad",
              title: "Akad",
              event_date: "2027-05-15",
              start_time: "08:00",
              venue_name: "Masjid",
              address: "Jl. 1",
              latitude: "-6.2",
              longitude: "106.8",
              timezone: "Asia/Jakarta",
              region_code: regionCode,
              display_order: 0,
            },
          ],
        })}
        templateDefinition={DEFINITION}
        activeSectionKey="event"
        transport={{
          save: async (group) => {
            saved.push({ key: group.key, fields: [...group.fields] });
          },
        }}
        debounceMs={10}
      >
        <PropertiesPanel />
      </EditorProvider>
    </AuthProvider>,
  );

  return { saved, located };
}

beforeEach(() => {
  accessTokenStore.clear();
});

afterEach(() => {
  cleanup();
});

describe("selectedChain", () => {
  it("reads every level off a code's own segments", () => {
    expect(selectedChain("51.71.01.1001")).toEqual([
      "51",
      "51.71",
      "51.71.01",
      "51.71.01.1001",
    ]);
    expect(selectedChain(null)).toEqual([]);
  });
});

describe("the region picker", () => {
  const row = () => screen.getByRole("group", { name: "Acara 1" });

  it("offers the provinces, then the chosen province's regencies", async () => {
    renderEditor();
    const province = await within(row()).findByRole("combobox", {
      name: "Provinsi",
    });
    await waitFor(() => {
      expect(
        within(province)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toContain("Bali");
    });
    expect(
      within(row()).queryByRole("combobox", { name: "Kabupaten/Kota" }),
    ).toBeNull();

    fireEvent.change(province, { target: { value: "51" } });

    const regency = await within(row()).findByRole("combobox", {
      name: "Kabupaten/Kota",
    });
    await waitFor(() => {
      expect(
        within(regency)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toContain("Kota Denpasar");
    });
  });

  it("sets the event's zone from the chosen province, and saves both", async () => {
    const { saved } = renderEditor();
    const province = await within(row()).findByRole("combobox", {
      name: "Provinsi",
    });
    await waitFor(() => {
      expect(within(province).getAllByRole("option").length).toBeGreaterThan(1);
    });

    fireEvent.change(province, { target: { value: "51" } });

    expect(
      within(row()).getByRole("combobox", { name: /zona waktu/i }),
    ).toHaveValue("Asia/Makassar");
    await waitFor(() => {
      expect(saved.at(-1)?.fields).toEqual(
        expect.arrayContaining([
          `events.${EVENT_ID}.region_code`,
          `events.${EVENT_ID}.timezone`,
        ]),
      );
    });
  });

  it("reopens an existing village with every level selected", async () => {
    renderEditor("51.71.01.1001");
    const village = await within(row()).findByRole("combobox", {
      name: "Kelurahan/Desa",
    });
    await waitFor(() => {
      expect(village).toHaveValue("51.71.01.1001");
    });
    expect(
      within(row()).getByRole("combobox", { name: "Kabupaten/Kota" }),
    ).toHaveValue("51.71");
  });

  it("asks the real boundary once the pin is still, and fills an empty region from it", async () => {
    const { located } = renderEditor();
    const latitude = within(row()).getByRole("spinbutton", {
      name: /lintang/i,
    });
    const longitude = within(row()).getByRole("spinbutton", { name: /bujur/i });

    fireEvent.change(latitude, { target: { value: "-8.65" } });
    fireEvent.change(longitude, { target: { value: "115.22" } });

    // One lookup for the settled pin, not one per keystroke.
    await waitFor(
      () => {
        expect(located).toEqual(["-8.65,115.22"]);
      },
      { timeout: 2000 },
    );
    await waitFor(() => {
      expect(
        within(row()).getByRole("combobox", { name: "Kabupaten/Kota" }),
      ).toHaveValue("51.03");
    });
    expect(
      within(row()).getByRole("combobox", { name: /zona waktu/i }),
    ).toHaveValue("Asia/Makassar");
  });
});
