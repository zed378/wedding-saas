import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient, accessTokenStore } from "@wi/api-client";
// jsdom has no `showModal`; see `share-preview.spec.tsx`.
import "@wi/ui/src/testing/setup.js";

import { AuthProvider } from "../src/lib/auth";
import { EditorProvider, useEditorContext } from "../src/editor/EditorProvider";
import { useEffect } from "react";
import { ChangeTemplate } from "../src/editor/ChangeTemplate";
import { previewTemplateChange } from "../src/editor/template-change";

/**
 * `P2-14` — the editor's change-template flow. `docs/UI-UX/05` § Change Template Flow.
 *
 * The rule is pinned against `docs/API/04`'s definition, because the dialog promises the user
 * what the server will do; the dialog is pinned on the order of events, because a template
 * change that lands before a pending edit is saved loses that edit.
 */

describe("previewTemplateChange — docs/API/04's rule, before the change", () => {
  const target = {
    sections: [{ section_key: "hero" }, { section_key: "quote" }],
    customizable_theme_keys: ["colors.primary"],
  };

  it("hides what is enabled now and the target does not define", () => {
    expect(
      previewTemplateChange({
        enabledSections: ["hero", "gallery", "quote", "gift"],
        themeOverride: {},
        target,
      }).hiddenSections,
    ).toEqual(["gallery", "gift"]);
  });

  it("does not list a section the user had already turned off", () => {
    // Not enabled, so nothing stops being displayed — listing it would alarm for nothing.
    expect(
      previewTemplateChange({
        enabledSections: ["hero"],
        themeOverride: {},
        target,
      }).hiddenSections,
    ).toEqual([]);
  });

  it("drops nested theme overrides the target does not make customizable", () => {
    expect(
      previewTemplateChange({
        enabledSections: [],
        themeOverride: { colors: { primary: "#111111", accent: "#222222" } },
        target,
      }).droppedThemeKeys,
    ).toEqual(["colors.accent"]);
  });

  it("tolerates a missing or malformed override", () => {
    for (const themeOverride of [undefined, null, [], "x"]) {
      expect(
        previewTemplateChange({ enabledSections: [], themeOverride, target })
          .droppedThemeKeys,
      ).toEqual([]);
    }
  });
});

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly at: number;
}

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "content-type": "application/json" },
  });

const TEMPLATES = [
  { id: "tpl-rose", slug: "elegant-rose", name: "Elegant Rose" },
  { id: "tpl-min", slug: "minimal", name: "Minimal" },
];

function renderEditor(
  options: {
    respond?: (call: Call) => Response | undefined;
    onChanged?: () => void;
    saves?: number[];
    pendingEdit?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  let clock = 0;

  const client = new ApiClient({
    baseUrl: "http://api.test/api/v1",
    tokenStore: accessTokenStore,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const call: Call = {
        method: init?.method ?? "GET",
        path: url.pathname.replace("/api/v1", ""),
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        at: (clock += 1),
      };
      calls.push(call);
      const custom = options.respond?.(call);
      if (custom !== undefined) return custom;
      if (call.path === "/templates") return ok(TEMPLATES);
      if (call.path === "/templates/minimal") {
        return ok({
          current_version: {
            sections: [{ section_key: "hero" }, { section_key: "quote" }],
            customizable_theme_keys: [],
          },
        });
      }
      if (call.path.endsWith("/change-template")) {
        return ok({
          template_id: "tpl-min",
          template_version_id: "ver-min",
          enabled_sections: ["hero", "quote"],
          hidden_sections: ["gallery"],
          dropped_theme_keys: [],
        });
      }
      return ok({});
    },
  });

  render(
    <AuthProvider client={client} restoreSession={false}>
      <EditorProvider
        invitationId="inv-1"
        data={{
          template: {
            slug: "elegant-rose",
            name: "Elegant Rose",
            version: "1.0.0",
          },
          settings: {
            enabled_sections: ["hero", "gallery", "quote"],
            theme_override: {},
          },
        }}
        transport={{
          save: async () => {
            options.saves?.push((clock += 1));
          },
        }}
        debounceMs={60_000}
      >
        {options.pendingEdit === true && <PendingEdit />}
        <ChangeTemplate
          {...(options.onChanged ? { onChanged: options.onChanged } : {})}
        />
      </EditorProvider>
    </AuthProvider>,
  );

  return calls;
}

/** An edit still inside its debounce window — the one a reload would throw away. */
function PendingEdit() {
  const { edit } = useEditorContext();
  useEffect(() => {
    edit("quote.text", "Kalimat terakhir yang belum tersimpan");
  }, [edit]);
  return null;
}

beforeEach(() => {
  accessTokenStore.clear();
});

afterEach(() => {
  cleanup();
});

describe("the change-template dialog", () => {
  const open = async () => {
    await userEvent.click(
      screen.getByRole("button", { name: "Ganti template" }),
    );
    return screen.findByRole("list", { name: "Pilihan template" });
  };

  it("lists the catalogue and marks the current template as not selectable", async () => {
    renderEditor();
    const list = await open();

    const current = await within(list).findByRole("button", {
      name: /elegant rose/i,
    });
    expect(current).toBeDisabled();
    expect(current).toHaveTextContent("Template saat ini");
    expect(
      within(list).getByRole("button", { name: /minimal/i }),
    ).toBeEnabled();
  });

  it("names the sections that will stop showing, and says their content is kept", async () => {
    renderEditor();
    const list = await open();
    await userEvent.click(
      await within(list).findByRole("button", { name: /minimal/i }),
    );

    const hidden = await screen.findByRole("list", {
      name: "Bagian yang tidak ditampilkan",
    });
    expect(within(hidden).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(/tetap tersimpan/i)).toBeInTheDocument();
  });

  it("changes nothing until the user confirms", async () => {
    const calls = renderEditor();
    const list = await open();
    await userEvent.click(
      await within(list).findByRole("button", { name: /minimal/i }),
    );
    await screen.findByRole("list", { name: "Bagian yang tidak ditampilkan" });

    await userEvent.click(screen.getByRole("button", { name: "Kembali" }));

    expect(calls.some((call) => call.path.endsWith("/change-template"))).toBe(
      false,
    );
  });

  it("sends only the template id, then reloads the editor", async () => {
    let changed = 0;
    const calls = renderEditor({
      onChanged: () => {
        changed += 1;
      },
    });
    const list = await open();
    await userEvent.click(
      await within(list).findByRole("button", { name: /minimal/i }),
    );
    await screen.findByRole("list", { name: "Bagian yang tidak ditampilkan" });

    // Two buttons share the name: the trigger in the header and the one in the dialog.
    const confirm = screen
      .getAllByRole("button", { name: "Ganti template" })
      .at(-1)!;
    await userEvent.click(confirm);

    const change = calls.find(
      (call) => call.path === "/invitations/inv-1/change-template",
    );
    expect(change?.method).toBe("POST");
    // Never `enabled_sections` or a version: `docs/API/04` has the server compute both.
    expect(change?.body).toEqual({ template_id: "tpl-min" });
    expect(changed).toBe(1);
  });

  it("saves a pending edit before asking for the change", async () => {
    const saves: number[] = [];
    const calls = renderEditor({ saves, pendingEdit: true });
    const list = await open();
    await userEvent.click(
      await within(list).findByRole("button", { name: /minimal/i }),
    );
    await screen.findByRole("list", { name: "Bagian yang tidak ditampilkan" });
    await userEvent.click(
      screen.getAllByRole("button", { name: "Ganti template" }).at(-1)!,
    );

    const change = calls.find((call) => call.path.endsWith("/change-template"));
    expect(saves.length, "the pending edit was never saved").toBeGreaterThan(0);
    expect(saves[0]!).toBeLessThan(change!.at);
  });

  it("shows the server's refusal and does not reload", async () => {
    let changed = 0;
    renderEditor({
      onChanged: () => {
        changed += 1;
      },
      respond: (call) =>
        call.path.endsWith("/change-template")
          ? new Response(
              JSON.stringify({
                success: false,
                error: {
                  code: "TEMPLATE_WOULD_LEAVE_PUBLISHED_INVITATION_INCOMPLETE",
                  message: "Template ini membutuhkan isian yang belum lengkap.",
                },
              }),
              { status: 422, headers: { "content-type": "application/json" } },
            )
          : undefined,
    });
    const list = await open();
    await userEvent.click(
      await within(list).findByRole("button", { name: /minimal/i }),
    );
    await screen.findByRole("list", { name: "Bagian yang tidak ditampilkan" });
    await userEvent.click(
      screen.getAllByRole("button", { name: "Ganti template" }).at(-1)!,
    );

    expect(await screen.findByText(/belum lengkap/i)).toBeInTheDocument();
    expect(changed).toBe(0);
  });
});
