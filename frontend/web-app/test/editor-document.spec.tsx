import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient, accessTokenStore } from "@wi/api-client";
import { TemplateRenderer } from "@wi/template-renderer";

import { AuthProvider } from "../src/lib/auth";
import { EditorProvider } from "../src/editor/EditorProvider";
import { PropertiesPanel } from "../src/editor/PropertiesPanel";
import { withInvitationSections } from "../src/editor/EditorScreen";
import { FIELD_REGISTRY } from "../src/editor/fields/registry";
import {
  getAtPath,
  setAtPath,
  type TemplateDefinition,
} from "../src/editor/store";
import {
  COLLECTIONS,
  createTransport,
  defaultGroupFor,
  toEditorDocument,
} from "../src/editor/transport";

/**
 * `P2-15` — the editor works in `docs/PLAN/08`'s canonical shape; the API speaks
 * `docs/API/04`'s.
 *
 * The full-stack E2E found the gap: the store held the API's shape while every path the panel
 * and the renderer used was canonical, so event fields were empty, an edit sent nothing, and
 * the preview drew no dates and no gift accounts. `P2-05`'s parity test could not see it — it
 * rendered one hand-written canonical fixture twice.
 *
 * These tests feed the editor what `GET /invitations/:id` actually returns.
 */

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_2 = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const PHOTO_ID = "44444444-4444-4444-8444-444444444444";
const MEDIA_ID = "55555555-5555-4555-8555-555555555555";
const PORTRAIT_ID = "66666666-6666-4666-8666-666666666666";

/** `GET /invitations/:id`, every field populated, in `docs/API/04`'s shape. */
const DETAIL = {
  id: "inv-1",
  internal_name: "Pernikahan Uji",
  status: "draft",
  slug: null,
  template: { slug: "elegant-rose", name: "Elegant Rose", version: "1.0.0" },
  updated_at: "2026-09-13T00:00:00.000Z",
  couple: {
    groom: {
      full_name: "Budi Santoso",
      nickname: "Budi",
      photo_media_id: PORTRAIT_ID,
      instagram: "budi",
      father_name: "Hendra",
      mother_name: "Ratna",
      child_order: "Putra pertama",
    },
    bride: {
      full_name: "Siti Rahayu",
      nickname: "Siti",
      photo_media_id: PORTRAIT_ID,
      instagram: "siti",
      father_name: "Joko",
      mother_name: "Lestari",
      child_order: "Putri kedua",
    },
  },
  events: [
    {
      id: EVENT_2,
      type: "reception",
      title: "Resepsi",
      event_date: "2027-05-15",
      start_time: "11:00",
      end_time: "14:00",
      venue_name: "Gedung Sate",
      address: "Jl. Diponegoro 22",
      latitude: "-6.9025",
      longitude: "107.6188",
      maps_url: "https://maps.example/2",
      description: "Resepsi keluarga",
      display_order: 1,
    },
    {
      id: EVENT_ID,
      type: "akad",
      title: "Akad Nikah",
      event_date: "2027-05-15",
      start_time: "08:00",
      end_time: "10:00",
      venue_name: "Masjid Agung",
      address: "Jl. Asia Afrika 1",
      latitude: "-6.9218",
      longitude: "107.6071",
      maps_url: "https://maps.example/1",
      description: "Akad",
      display_order: 0,
    },
  ],
  gallery: [
    {
      id: PHOTO_ID,
      media_id: MEDIA_ID,
      caption: "Prewedding",
      display_order: 0,
      is_cover: true,
    },
  ],
  bank_accounts: [
    {
      id: ACCOUNT_ID,
      type: "bank",
      provider_name: "BCA",
      account_number: "8801234567",
      account_holder: "Budi Santoso",
      display_order: 0,
    },
  ],
  quote: { text: "Sebuah kutipan", source: "Ar-Rum 21" },
  settings: {
    enabled_sections: ["hero", "event", "gift", "quote"],
    theme_override: {},
    rsvp_enabled: true,
    guestbook_enabled: true,
    guestbook_moderation: false,
    seo_indexable: false,
  },
};

const MEDIA = new Map([
  [
    MEDIA_ID,
    {
      url: "https://cdn.test/cover-large.webp",
      medium_url: "https://cdn.test/cover-medium.webp",
      thumbnail_url: "https://cdn.test/cover-thumb.webp",
    },
  ],
  [PORTRAIT_ID, { thumbnail_url: "https://cdn.test/portrait-thumb.webp" }],
]);

beforeEach(() => {
  accessTokenStore.clear();
});

afterEach(() => {
  cleanup();
});

describe("toEditorDocument", () => {
  const doc = toEditorDocument(DETAIL, MEDIA);

  it("resolves every scalar path the field registry knows, for a full invitation", () => {
    // The drift guard. A registry path the document cannot answer is a field the panel shows
    // empty and the preview does not draw — the exact failure `P2-15` exists for.
    const firstId: Record<string, string> = {
      events: EVENT_ID,
      "gallery.photos": PHOTO_ID,
      "gift.accounts": ACCOUNT_ID,
    };
    const unresolved = Object.keys(FIELD_REGISTRY).filter((pattern) => {
      const concrete = Object.entries(firstId).reduce(
        (path, [collection, id]) =>
          path.startsWith(`${collection}.*.`)
            ? `${collection}.${id}.${path.slice(collection.length + 3)}`
            : path,
        pattern,
      );
      const value = getAtPath(doc, concrete);
      return value === undefined || value === null;
    });

    expect(unresolved).toEqual([]);
  });

  it("orders rows by display_order, as the API and the public page do", () => {
    expect((doc["events"] as { id: string }[]).map((e) => e.id)).toEqual([
      EVENT_ID,
      EVENT_2,
    ]);
  });

  it("carries the names the renderer reads, not the API's", () => {
    expect(getAtPath(doc, `events.${EVENT_ID}.date`)).toBe("2027-05-15");
    expect(getAtPath(doc, `gift.accounts.${ACCOUNT_ID}.account_number`)).toBe(
      "8801234567",
    );
    expect(doc).not.toHaveProperty("bank_accounts");
    expect(getAtPath(doc, "gallery.photos.0.medium_url")).toBe(
      "https://cdn.test/cover-medium.webp",
    );
    expect(getAtPath(doc, "couple.groom.photo")).toBe(
      "https://cdn.test/portrait-thumb.webp",
    );
  });

  it("keeps what it does not reshape", () => {
    expect(doc["settings"]).toEqual(DETAIL.settings);
    expect(doc["template"]).toEqual(DETAIL.template);
    expect(doc["quote"]).toEqual(DETAIL.quote);
  });
});

describe("the section toggles start from the invitation, not the template", () => {
  it("uses the stored enabled_sections over the template's defaults", () => {
    const definition: TemplateDefinition = {
      sections: [
        { section_key: "hero" },
        { section_key: "gift", enabled_by_default: false },
      ],
      enabledSections: ["hero"],
    };
    expect(
      withInvitationSections(definition, {
        settings: { enabled_sections: ["hero", "gift"] },
      })?.enabledSections,
    ).toEqual(["hero", "gift"]);
  });

  it("falls back to the defaults for an invitation with no stored selection", () => {
    const definition: TemplateDefinition = {
      sections: [],
      enabledSections: ["hero"],
    };
    expect(withInvitationSections(definition, {})?.enabledSections).toEqual([
      "hero",
    ]);
  });
});

describe("rows are addressed by id", () => {
  const data = {
    events: [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ],
  };

  it("reads and writes the row with that id, whatever its position", () => {
    const next = setAtPath(data, "events.b.title", "B2");
    expect(getAtPath(next, "events.b.title")).toBe("B2");
    expect(getAtPath(next, "events.a.title")).toBe("A");
    // Immutable: subscribers holding the old list must see a new reference.
    expect(next["events"]).not.toBe(data.events);
  });

  it("changes nothing for a row that does not exist, rather than inventing one", () => {
    const next = setAtPath(data, "events.gone.title", "X");
    expect(next["events"]).toEqual(data.events);
  });
});

describe("the transport maps canonical paths onto sub-resources", () => {
  interface Sent {
    readonly method: string;
    readonly path: string;
    readonly body: unknown;
  }

  const transportWith = (doc: Record<string, unknown>) => {
    const sent: Sent[] = [];
    const api = new ApiClient({
      baseUrl: "http://api.test/api/v1",
      tokenStore: accessTokenStore,
      fetch: async (input, init) => {
        sent.push({
          method: init?.method ?? "GET",
          path: new URL(String(input)).pathname.replace("/api/v1", ""),
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        return new Response(JSON.stringify({ success: true, data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    return {
      sent,
      transport: createTransport({
        api,
        invitationId: "inv-1",
        readData: () => doc,
      }),
    };
  };

  const doc = toEditorDocument(DETAIL, MEDIA);

  it.each([
    [`events.${EVENT_ID}.title`, `events:${EVENT_ID}`],
    [
      `gift.accounts.${ACCOUNT_ID}.provider_name`,
      `gift.accounts:${ACCOUNT_ID}`,
    ],
    ["couple.groom.nickname", "couple:groom"],
    ["settings.rsvp_enabled", "settings"],
    ["quote.text", "quote"],
  ])("groups %s as %s", (path, key) => {
    expect(defaultGroupFor(path)).toBe(key);
  });

  it("sends an event edit to that event, with the API's field names", async () => {
    const { sent, transport } = transportWith(doc);
    await transport.save({
      key: `events:${EVENT_ID}`,
      fields: [`events.${EVENT_ID}.date`, `events.${EVENT_ID}.title`],
    });
    expect(sent).toEqual([
      {
        method: "PATCH",
        path: `/invitations/inv-1/events/${EVENT_ID}`,
        body: { event_date: "2027-05-15", title: "Akad Nikah" },
      },
    ]);
  });

  it("sends a gift account edit to the bank-accounts sub-resource", async () => {
    const { sent, transport } = transportWith(doc);
    await transport.save({
      key: `gift.accounts:${ACCOUNT_ID}`,
      fields: [`gift.accounts.${ACCOUNT_ID}.account_number`],
    });
    expect(sent[0]).toEqual({
      method: "PATCH",
      path: `/invitations/inv-1/bank-accounts/${ACCOUNT_ID}`,
      body: { account_number: "8801234567" },
    });
  });

  it("refuses a row addressed by index instead of PATCHing /events/0", async () => {
    const { sent, transport } = transportWith(doc);
    await expect(
      transport.save({ key: "events:0", fields: ["events.0.title"] }),
    ).rejects.toThrow(/Perubahan belum tersimpan/);
    expect(sent).toEqual([]);
  });

  it("knows the API's required fields for every collection it can create", () => {
    for (const collection of COLLECTIONS) {
      expect(collection.required.length, collection.path).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------------------------

const DEFINITION: TemplateDefinition = {
  sections: [
    {
      section_key: "event",
      component: "EventCardDouble",
      configurable: false,
      enabled_by_default: true,
      required_fields: ["events.*.title", "events.*.date"],
      optional_fields: [],
    },
    {
      section_key: "gift",
      component: "GiftAccountList",
      configurable: true,
      enabled_by_default: true,
      required_fields: [
        "gift.accounts.*.provider_name",
        "gift.accounts.*.account_number",
        "gift.accounts.*.account_holder",
      ],
      optional_fields: [],
    },
  ],
  enabledSections: ["event", "gift"],
};

function renderPanel(activeSection: string) {
  const saved: { key: string; fields: string[] }[] = [];
  const requests: { method: string; path: string; body: unknown }[] = [];

  const client = new ApiClient({
    baseUrl: "http://api.test/api/v1",
    tokenStore: accessTokenStore,
    fetch: async (input, init) => {
      const method = init?.method ?? "GET";
      const path = new URL(String(input)).pathname.replace("/api/v1", "");
      const body =
        init?.body === undefined ? undefined : JSON.parse(String(init.body));
      requests.push({ method, path, body });
      const data =
        method === "POST"
          ? {
              id: "77777777-7777-4777-8777-777777777777",
              type: "bank",
              provider_name: "Mandiri",
              account_number: "1234000",
              account_holder: "Siti Rahayu",
              display_order: 1,
            }
          : {};
      return new Response(JSON.stringify({ success: true, data }), {
        status: method === "POST" ? 201 : 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  render(
    <AuthProvider client={client} restoreSession={false}>
      <EditorProvider
        invitationId="inv-1"
        data={toEditorDocument(DETAIL, MEDIA)}
        templateDefinition={DEFINITION}
        activeSectionKey={activeSection}
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

  return { saved, requests };
}

describe("the panel edits collections row by row", () => {
  it("shows each existing event's values, not empty fields", () => {
    renderPanel("event");

    const first = screen.getByRole("group", { name: "Acara 1" });
    expect(within(first).getByLabelText(/judul acara/i)).toHaveValue(
      "Akad Nikah",
    );
    expect(within(first).getByLabelText(/tanggal/i)).toHaveValue("2027-05-15");
    const second = screen.getByRole("group", { name: "Acara 2" });
    expect(within(second).getByLabelText(/judul acara/i)).toHaveValue(
      "Resepsi",
    );
  });

  it("saves an edit to the row it was typed into, by id", async () => {
    const { saved } = renderPanel("event");

    const second = screen.getByRole("group", { name: "Acara 2" });
    const title = within(second).getByLabelText(/judul acara/i);
    await userEvent.clear(title);
    await userEvent.type(title, "Resepsi Keluarga");

    await waitFor(() => {
      expect(saved.at(-1)).toEqual({
        key: `events:${EVENT_2}`,
        fields: [`events.${EVENT_2}.title`],
      });
    });
  });

  it("adds a gift account in one POST with the API's field names, and lists it", async () => {
    const { requests } = renderPanel("gift");

    await userEvent.click(
      screen.getByRole("button", { name: "Tambah rekening" }),
    );
    const form = screen.getByRole("group", { name: "Rekening baru" });
    await userEvent.type(within(form).getByLabelText(/nama bank/i), "Mandiri");
    await userEvent.type(
      within(form).getByLabelText(/nomor rekening/i),
      "1234000",
    );
    await userEvent.type(
      within(form).getByLabelText(/atas nama/i),
      "Siti Rahayu",
    );
    await userEvent.click(
      within(form).getByRole("button", { name: "Simpan rekening" }),
    );

    const post = requests.find((r) => r.method === "POST");
    expect(post?.path).toBe("/invitations/inv-1/bank-accounts");
    expect(post?.body).toEqual({
      type: "bank",
      provider_name: "Mandiri",
      account_number: "1234000",
      account_holder: "Siti Rahayu",
    });
    expect(
      await screen.findByRole("group", { name: "Rekening 2" }),
    ).toBeInTheDocument();
  });

  it("does not POST a new row until the API's required fields are filled", async () => {
    const { requests } = renderPanel("gift");

    await userEvent.click(
      screen.getByRole("button", { name: "Tambah rekening" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Simpan rekening" }),
    );

    expect(requests.some((r) => r.method === "POST")).toBe(false);
    expect(screen.getByText(/lengkapi isian/i)).toBeInTheDocument();
  });

  it("deletes a row on the server, then removes it", async () => {
    const { requests } = renderPanel("gift");

    await userEvent.click(
      screen.getByRole("button", { name: "Hapus rekening 1" }),
    );

    await waitFor(() => {
      expect(requests).toContainEqual({
        method: "DELETE",
        path: `/invitations/inv-1/bank-accounts/${ACCOUNT_ID}`,
        body: undefined,
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("group", { name: "Rekening 1" })).toBeNull();
    });
  });
});

describe("the preview and the public page draw the same invitation", () => {
  it("renders identical markup from the editor document and the public payload", () => {
    // The replacement for `P2-05`'s parity test, which rendered one canonical fixture twice.
    // Here each side gets what it really receives: the editor, `GET /invitations/:id` through
    // `toEditorDocument`; the public page, `GET /public/i/:slug` as `docs/API/08` shapes it.
    const publicPayload = {
      couple: {
        groom: {
          full_name: "Budi Santoso",
          nickname: "Budi",
          instagram: "budi",
          father_name: "Hendra",
          mother_name: "Ratna",
          child_order: "Putra pertama",
          photo: "https://cdn.test/portrait-thumb.webp",
        },
        bride: {
          full_name: "Siti Rahayu",
          nickname: "Siti",
          instagram: "siti",
          father_name: "Joko",
          mother_name: "Lestari",
          child_order: "Putri kedua",
          photo: "https://cdn.test/portrait-thumb.webp",
        },
      },
      events: [
        {
          type: "akad",
          title: "Akad Nikah",
          date: "2027-05-15",
          start_time: "08:00",
          end_time: "10:00",
          venue_name: "Masjid Agung",
          address: "Jl. Asia Afrika 1",
          latitude: "-6.9218",
          longitude: "107.6071",
          maps_url: "https://maps.example/1",
          description: "Akad",
          order: 0,
        },
        {
          type: "reception",
          title: "Resepsi",
          date: "2027-05-15",
          start_time: "11:00",
          end_time: "14:00",
          venue_name: "Gedung Sate",
          address: "Jl. Diponegoro 22",
          latitude: "-6.9025",
          longitude: "107.6188",
          maps_url: "https://maps.example/2",
          description: "Resepsi keluarga",
          order: 1,
        },
      ],
      gallery: {
        photos: [
          {
            url: "https://cdn.test/cover-large.webp",
            medium_url: "https://cdn.test/cover-medium.webp",
            thumbnail_url: "https://cdn.test/cover-thumb.webp",
            caption: "Prewedding",
            is_cover: true,
            order: 0,
          },
        ],
      },
      gift: {
        accounts: [
          {
            type: "bank",
            provider_name: "BCA",
            account_number: "8801234567",
            account_holder: "Budi Santoso",
            order: 0,
          },
        ],
      },
      quote: { text: "Sebuah kutipan", source: "Ar-Rum 21" },
    };

    const version = {
      sections: [
        [
          "hero",
          "HeroClassic",
          ["couple.groom.nickname", "couple.bride.nickname", "events.*.date"],
          ["gallery.photos"],
        ],
        [
          "couple",
          "CoupleProfile",
          ["couple.groom.full_name", "couple.bride.full_name"],
          [
            "couple.groom.photo",
            "couple.bride.photo",
            "couple.groom.father_name",
          ],
        ],
        [
          "event",
          "EventCardDouble",
          [
            "events.*.title",
            "events.*.date",
            "events.*.start_time",
            "events.*.venue_name",
            "events.*.address",
          ],
          ["events.*.end_time"],
        ],
        [
          "gallery",
          "GalleryGrid",
          ["gallery.photos"],
          ["gallery.photos.*.caption"],
        ],
        [
          "gift",
          "GiftAccountList",
          [
            "gift.accounts.*.provider_name",
            "gift.accounts.*.account_number",
            "gift.accounts.*.account_holder",
          ],
          [],
        ],
        ["quote", "QuoteBanner", ["quote.text"], ["quote.source"]],
      ].map(([section_key, component, required_fields, optional_fields]) => ({
        section_key: section_key as string,
        component: component as string,
        enabled_by_default: true,
        configurable: true,
        required_fields: required_fields as string[],
        optional_fields: optional_fields as string[],
      })),
      theme: {},
      customizable_theme_keys: [],
    };
    const enabled = ["hero", "couple", "event", "gallery", "gift", "quote"];

    const editorSide = render(
      <TemplateRenderer
        mode="public"
        templateVersion={version}
        invitationData={toEditorDocument(DETAIL, MEDIA)}
        enabledSections={enabled}
      />,
    ).container.innerHTML;
    cleanup();
    const publicSide = render(
      <TemplateRenderer
        mode="public"
        templateVersion={version}
        invitationData={publicPayload}
        enabledSections={enabled}
      />,
    ).container.innerHTML;

    // Not vacuous: the markup carries what was missing before `P2-15`.
    expect(editorSide).toContain("8801234567");
    expect(editorSide).toContain("2027-05-15");
    expect(editorSide).toContain("cover-medium.webp");
    expect(editorSide).toBe(publicSide);
  });
});
