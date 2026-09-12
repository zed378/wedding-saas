import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient, accessTokenStore } from "@wi/api-client";
import { INVITATION_FIELDS, INVITATION_FIELD_PATHS } from "@wi/schema";
import { axeViolationIds } from "@wi/ui/src/testing/axe.js";

import { AuthProvider } from "../src/lib/auth";
import { EditorProvider } from "../src/editor/EditorProvider";
import { PropertiesPanel } from "../src/editor/PropertiesPanel";
import {
  canonicalise,
  COLLECTION_PATHS,
  FIELD_REGISTRY,
  fieldMeta,
  type FieldType,
} from "../src/editor/fields/registry";
import { validateField } from "../src/editor/fields/validate";
import type { TemplateDefinition } from "../src/editor/store";

/**
 * P1-23 — the schema-driven panel.
 *
 * The card's first DoD item is the one that matters: "adding a field to a template's
 * `required_fields` changes the rendered form with **no frontend code change**". A test can
 * only demonstrate that by changing a fixture and nothing else, which is what the first
 * describe block does.
 */

function withTemplate(definition: TemplateDefinition, data = {}) {
  const saved: string[][] = [];

  const client = new ApiClient({
    baseUrl: "http://api.test/v1",
    tokenStore: accessTokenStore,
    fetch: async () =>
      new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

  return {
    saved,
    ...render(
      <AuthProvider client={client} restoreSession={false}>
        <EditorProvider
          invitationId="i1"
          data={data}
          templateDefinition={definition}
          transport={{
            save: async (group) => {
              saved.push([...group.fields]);
            },
          }}
          debounceMs={10}
        >
          <PropertiesPanel />
        </EditorProvider>
      </AuthProvider>,
    ),
  };
}

const sectionWith = (
  required: readonly string[],
  optional: readonly string[] = [],
): TemplateDefinition => ({
  sections: [
    {
      section_key: "couple",
      configurable: false,
      enabled_by_default: true,
      required_fields: required,
      optional_fields: optional,
    },
  ],
  enabledSections: ["couple"],
});

beforeEach(() => {
  accessTokenStore.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------ DoD item 1

describe("the form comes from the template (card DoD 1)", () => {
  it("renders exactly the fields the section asked for", () => {
    withTemplate(sectionWith(["couple.groom.full_name"]));

    expect(
      screen.getByLabelText(/nama lengkap mempelai pria/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/nama panggilan/i)).toBeNull();
  });

  it("adding a field to the FIXTURE changes the form, with no code change", () => {
    // The whole point of the template system, demonstrated: the only difference between
    // these two renders is one string in a fixture.
    cleanup();
    withTemplate(sectionWith(["couple.groom.full_name"]));
    expect(screen.queryByLabelText(/instagram mempelai pria/i)).toBeNull();

    cleanup();
    withTemplate(
      sectionWith(["couple.groom.full_name", "couple.groom.instagram"]),
    );
    expect(
      screen.getByLabelText(/instagram mempelai pria/i),
    ).toBeInTheDocument();
  });

  it("renders required fields before optional ones", () => {
    withTemplate(
      sectionWith(["couple.groom.nickname"], ["couple.groom.instagram"]),
    );

    const inputs = screen.getAllByRole("textbox");
    expect(inputs[0]).toHaveAccessibleName(/nama panggilan/i);
  });

  it("marks required and does not mark optional", () => {
    withTemplate(
      sectionWith(["couple.groom.nickname"], ["couple.groom.instagram"]),
    );

    expect(screen.getByLabelText(/nama panggilan/i)).toBeRequired();
    expect(screen.getByLabelText(/instagram/i)).not.toBeRequired();
  });

  it("says so when a path this build does not know is requested", () => {
    // A template written against a later registry. Rendering nothing would show a section
    // silently missing a control.
    withTemplate(sectionWith(["couple.groom.favourite_colour"]));

    expect(screen.getByText(/belum dikenali/i)).toBeInTheDocument();
  });

  it("does not render a text box for a collection", () => {
    // `events` names a list. A control here would ask somebody to type one, and there is no
    // list editor for events yet — `P1-24` built the photo one only.
    withTemplate(sectionWith(["events"]));

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/belum dapat diubah/i)).toBeInTheDocument();
  });

  it("renders the gallery manager for the photo collection", () => {
    // The one collection that does have an editor. Recognised through the registry — the
    // panel asks whether `<path>.*.media_id` is a `photo-multi` rather than naming the path,
    // which `scripts/check-no-hardcoded-fields.mjs` would refuse.
    withTemplate(sectionWith(["gallery.photos"]));

    expect(
      screen.getByRole("region", { name: /galeri foto/i }),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = withTemplate(
      sectionWith(
        ["couple.groom.full_name", "events.0.date", "events.0.type"],
        ["quote.text", "gallery.photos.0.is_cover"],
      ),
    );

    expect(await axeViolationIds(container)).toEqual([]);
  });
});

// ---------------------------------------------------------------- DoD item 2/3

describe("the registry mirrors @wi/schema (card DoD 3)", () => {
  it("has an entry for every scalar path the backend recognises", () => {
    // The drift guard, in the direction that matters: adding a field to `docs/PLAN/08`
    // without a label here fails the frontend build rather than rendering an unlabelled
    // control months later.
    const scalars = INVITATION_FIELDS.filter((f) => f.kind === "scalar").map(
      (f) => f.path,
    );

    const missing = scalars.filter(
      (path) => FIELD_REGISTRY[path] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("has no entry for a path the backend does not recognise", () => {
    const canonical = new Set(INVITATION_FIELD_PATHS);
    const extra = Object.keys(FIELD_REGISTRY).filter(
      (path) => !canonical.has(path),
    );

    expect(extra).toEqual([]);
  });

  it("accounts for every collection path by name, with a reason", () => {
    // Named individually rather than inferred from a shape: an inferred rule would silently
    // exempt a real field the day somebody added one at the top level.
    const collections = INVITATION_FIELDS.filter(
      (f) => f.kind === "collection",
    ).map((f) => f.path);

    for (const path of collections) {
      expect(COLLECTION_PATHS[path], `${path} needs a reason`).toEqual(
        expect.any(String),
      );
      expect(COLLECTION_PATHS[path]!.length).toBeGreaterThan(20);
    }
  });

  it("every registry type has a component", () => {
    // The DoD's "every registry field type has a component". The panel's switch is
    // exhaustive over this union, so a new type without a branch is a type error — this
    // asserts the union itself has not grown a member nothing uses.
    const used = new Set(Object.values(FIELD_REGISTRY).map((m) => m.type));
    const all: FieldType[] = [
      "text",
      "textarea",
      "date",
      "time",
      "photo",
      "photo-multi",
      "select",
      "map-picker",
      "toggle",
    ];

    for (const type of all) {
      expect(used.has(type), `no field uses ${type}`).toBe(true);
    }
  });

  it("every select carries its options", () => {
    for (const [path, meta] of Object.entries(FIELD_REGISTRY)) {
      if (meta.type !== "select") continue;
      expect(meta.options?.length, `${path} has no options`).toBeGreaterThan(0);
    }
  });
});

describe("canonicalise", () => {
  it.each([
    ["events.0.title", "events.*.title"],
    ["events.2.venue_name", "events.*.venue_name"],
    ["events.11111111-1111-4111-8111-111111111111.title", "events.*.title"],
    ["gallery.photos.3.caption", "gallery.photos.*.caption"],
    ["couple.groom.nickname", "couple.groom.nickname"],
  ])("maps %s to %s", (concrete, canonical) => {
    expect(canonicalise(concrete)).toBe(canonical);
  });

  it("resolves a concrete path to the canonical entry", () => {
    expect(fieldMeta("events.0.date")?.type).toBe("date");
  });

  it("never turns a leading segment into a wildcard", () => {
    // The first segment names the family; a numeric one would be nonsense, and turning it
    // into `*` would make every path look like a collection.
    expect(canonicalise("0.title")).toBe("0.title");
  });
});

// ------------------------------------------------------------------ DoD item 4

describe("client validation mirrors the server (card DoD 4)", () => {
  const meta = (path: string) => fieldMeta(path)!;

  it("says nothing about an empty field", () => {
    // Whether a field may be empty is a COMPLETENESS question, decided by the template's
    // `required_fields` at publish time (BR-4.2) — not something to shout about mid-form.
    expect(validateField(meta("quote.text"), "quote.text", "")).toBeUndefined();
    expect(
      validateField(meta("quote.text"), "quote.text", undefined),
    ).toBeUndefined();
  });

  it("enforces the column width from docs/DATABASE/05", () => {
    expect(
      validateField(
        meta("couple.groom.full_name"),
        "couple.groom.full_name",
        "x".repeat(151),
      ),
    ).toMatch(/150/);
  });

  it.each([
    ["2027-06-12", undefined],
    ["12-06-2027", /YYYY-MM-DD/],
    ["2027-13-45", /tidak valid/i],
  ])("validates the date %s", (value, expected) => {
    const result = validateField(meta("events.*.date"), "events.*.date", value);
    if (expected === undefined) expect(result).toBeUndefined();
    else expect(result).toMatch(expected);
  });

  it.each([
    ["08:00", undefined],
    ["23:59", undefined],
    ["24:00", /HH:MM/],
    ["8:00", /HH:MM/],
  ])("validates the time %s", (value, expected) => {
    const result = validateField(
      meta("events.*.start_time"),
      "events.*.start_time",
      value,
    );
    if (expected === undefined) expect(result).toBeUndefined();
    else expect(result).toMatch(expected);
  });

  it("rejects a select value outside the options the CHECK constraint permits", () => {
    // A fourth option here would be accepted by the form and rejected by the database.
    expect(
      validateField(meta("events.*.type"), "events.*.type", "engagement"),
    ).toMatch(/opsi/i);
    expect(
      validateField(meta("events.*.type"), "events.*.type", "akad"),
    ).toBeUndefined();
  });

  it("bounds latitude at 90 and longitude at 180", () => {
    // One control, two bounds — which one applies comes from the path.
    expect(
      validateField(meta("events.*.latitude"), "events.*.latitude", 95),
    ).toMatch(/90/);
    expect(
      validateField(meta("events.*.longitude"), "events.*.longitude", 95),
    ).toBeUndefined();
    expect(
      validateField(meta("events.*.longitude"), "events.*.longitude", 181),
    ).toMatch(/180/);
  });

  it("refuses a javascript: maps url, the way the server does", () => {
    // `P1-12` measured that `z.string().url()` ACCEPTS `javascript:alert(1)` and added a
    // `^https?://` prefix check server-side. Mirrored so the user is told while typing.
    expect(
      validateField(
        meta("events.*.maps_url"),
        "events.*.maps_url",
        "javascript:alert(1)",
      ),
    ).toMatch(/http/);
    expect(
      validateField(
        meta("events.*.maps_url"),
        "events.*.maps_url",
        "https://maps.example/x",
      ),
    ).toBeUndefined();
  });

  it("wants an Instagram handle without the @", () => {
    expect(
      validateField(
        meta("couple.groom.instagram"),
        "couple.groom.instagram",
        "@budi",
      ),
    ).toMatch(/@/);
    expect(
      validateField(
        meta("couple.groom.instagram"),
        "couple.groom.instagram",
        "budi.ani_",
      ),
    ).toBeUndefined();
  });

  it("does not sanitize, because the server does", () => {
    // `docs/SECURITY/08` puts stored-XSS prevention on the server and `P1-16` built it
    // there. A frontend that stripped tags would make the server's sanitiser look
    // unnecessary — and the API accepts requests that never came from this form.
    const value = "<script>alert(1)</script>";
    expect(
      validateField(meta("quote.text"), "quote.text", value),
    ).toBeUndefined();
  });
});

// ------------------------------------------------------------------- the panel

describe("editing through the panel", () => {
  it("writes the value into the store and queues the save", async () => {
    const { saved } = withTemplate(sectionWith(["couple.groom.nickname"]));

    await userEvent.type(screen.getByLabelText(/nama panggilan/i), "Budi");

    await waitFor(() => {
      expect(saved.flat()).toContain("couple.groom.nickname");
    });
  });

  it("does not show an error before the user has typed", async () => {
    // A form that shouts at people for arriving is a form people leave.
    withTemplate(sectionWith(["events.0.date"]), {
      events: { 0: { date: "not-a-date" } },
    });

    expect(screen.queryByText(/YYYY-MM-DD/)).toBeNull();
  });

  it("shows a validation error once the field has been touched", async () => {
    // `maps_url` rather than a time field: an `<input type="time">` refuses to hold
    // "99:99" at all, so a test typing it there asserts a state the control makes
    // unreachable. This one is both reachable and the security-relevant case.
    withTemplate(sectionWith(["events.0.maps_url"]));

    await userEvent.type(
      screen.getByLabelText(/tautan peta/i),
      "javascript:alert(1)",
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/tautan peta/i)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
  });

  it("still saves an invalid value, because the server decides", async () => {
    // Client validation is "fast UX, non-authoritative" (`docs/FRONTEND/03`). Refusing to
    // send would mean the client had the final say on a rule the server owns — and a
    // mirror that is stricter than the original silently blocks legitimate input. The
    // server rejects this one; `P1-12` added that check after measuring that Zod's `.url()`
    // accepts it.
    const { saved } = withTemplate(sectionWith(["events.0.maps_url"]));

    await userEvent.type(
      screen.getByLabelText(/tautan peta/i),
      "javascript:alert(1)",
    );

    await waitFor(() => {
      expect(saved.flat()).toContain("events.0.maps_url");
    });
  });
});
