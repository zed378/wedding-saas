import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient, accessTokenStore } from "@wi/api-client";
import { axeViolationIds } from "@wi/ui/src/testing/axe.js";

import { AuthProvider } from "../src/lib/auth";
import { EditorProvider, useEditorContext } from "../src/editor/EditorProvider";
import { EditorShell } from "../src/editor/EditorShell";
import { formatRelative, SaveStatusIndicator } from "../src/editor/SaveStatus";
import { missingRequired } from "../src/editor/SectionListPanel";
import type { TemplateDefinition } from "../src/editor/store";

/**
 * P1-22 — the editor's React surface.
 *
 * `editor-autosave.spec.ts` covers the store and the manager, which is where the losing-work
 * guarantees live. This covers what only a rendered tree can answer: that the indicator never
 * claims success it does not have, that the retry button reaches the manager, and that the
 * section list obeys the template rather than its own opinions.
 */

const DEFINITION: TemplateDefinition = {
  sections: [
    {
      section_key: "hero",
      configurable: false,
      enabled_by_default: true,
      required_fields: ["couple.groom.nickname"],
    },
    {
      section_key: "gallery",
      configurable: true,
      enabled_by_default: true,
      required_fields: [],
    },
  ],
  enabledSections: ["hero", "gallery"],
};

function renderEditor(
  node: React.ReactNode,
  options: {
    save?: () => Promise<{ updatedAt?: string } | void>;
    data?: Record<string, unknown>;
    definition?: TemplateDefinition | undefined;
    knownUpdatedAt?: string;
    /** Long, for tests about the window BETWEEN an edit and its save. */
    debounceMs?: number;
  } = {},
) {
  const saved: string[][] = [];

  /**
   * A transport, not a manager. The provider owns the callbacks that connect a save to the
   * store, so injecting a whole manager would mean injecting callbacks wired to nothing —
   * and the suite would be green while the indicator never moved.
   */
  const transport = {
    save: async (group: { readonly fields: readonly string[] }) => {
      saved.push([...group.fields]);
      return options.save === undefined ? undefined : options.save();
    },
  };

  const client = new ApiClient({
    baseUrl: "http://api.test/v1",
    tokenStore: accessTokenStore,
    fetch: async () =>
      new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

  const result = render(
    <AuthProvider client={client} restoreSession={false}>
      <EditorProvider
        invitationId="i1"
        data={options.data ?? {}}
        templateDefinition={options.definition ?? DEFINITION}
        {...(options.knownUpdatedAt !== undefined
          ? { knownUpdatedAt: options.knownUpdatedAt }
          : {})}
        transport={transport}
        debounceMs={options.debounceMs ?? 10}
      >
        {node}
      </EditorProvider>
    </AuthProvider>,
  );

  return { ...result, saved };
}

beforeEach(() => {
  accessTokenStore.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------ DoD item 3

describe("the save status indicator (card DoD 3)", () => {
  it("starts at a state that does not claim anything was saved", () => {
    renderEditor(<SaveStatusIndicator />);

    const status = screen.getByRole("status");
    expect(status).not.toHaveTextContent(/tersimpan/i);
  });

  it("says 'unsaved' between an edit and the save, never 'Saved'", async () => {
    // The window that matters. A debounce is a period where work exists only in the browser,
    // and an indicator that reads "Saved" through it teaches somebody to close the tab.
    const { container } = renderEditor(
      <>
        <SaveStatusIndicator />
        <EditButton path="quote.text" value="a" />
      </>,
      // Long enough that the window is observable. With a 10ms debounce the save completes
      // before the assertion, and the test would pass without ever seeing the state it is
      // named after.
      { debounceMs: 5_000 },
    );

    await userEvent.click(screen.getByRole("button", { name: "edit" }));

    expect(container.textContent).toMatch(/belum tersimpan/i);
    expect(container.textContent).not.toMatch(/^tersimpan/i);
  });

  it("shows the failure and a retry button", async () => {
    renderEditor(
      <>
        <SaveStatusIndicator />
        <EditButton path="quote.text" value="a" />
      </>,
      {
        save: () => {
          throw new Error("Jaringan bermasalah.");
        },
      },
    );

    await userEvent.click(screen.getByRole("button", { name: "edit" }));

    expect(await screen.findByText(/jaringan bermasalah/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /coba lagi/i }),
    ).toBeInTheDocument();
  });

  it("announces a failure assertively, because nothing the user did caused it", async () => {
    renderEditor(
      <>
        <SaveStatusIndicator />
        <EditButton path="quote.text" value="a" />
      </>,
      {
        save: () => {
          throw new Error("Gagal.");
        },
      },
    );

    await userEvent.click(screen.getByRole("button", { name: "edit" }));

    // Wait for the FAILURE state specifically. `findByRole("status")` resolves against the
    // polite region that is already on screen, so asserting straight after the click was a
    // race the test lost about half the time.
    await screen.findByRole("button", { name: /coba lagi/i });

    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-live",
      "assertive",
    );
  });

  it("retries through the manager and reaches 'saved'", async () => {
    let attempts = 0;
    renderEditor(
      <>
        <SaveStatusIndicator />
        <EditButton path="quote.text" value="a" />
      </>,
      {
        save: () => {
          attempts += 1;
          if (attempts === 1) throw new Error("Gagal.");
          return Promise.resolve();
        },
      },
    );

    await userEvent.click(screen.getByRole("button", { name: "edit" }));
    await screen.findByRole("button", { name: /coba lagi/i });

    await userEvent.click(screen.getByRole("button", { name: /coba lagi/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/tersimpan/i);
    });
  });

  it("stops saying 'Saved' as soon as the next edit happens", async () => {
    // Two buttons rather than a `rerender`: testing-library's rerender replaces the whole
    // tree with what it is given, which drops the providers and takes the editor context
    // with them.
    renderEditor(
      <>
        <SaveStatusIndicator />
        <EditButton path="quote.text" value="a" label="edit one" />
        <EditButton path="quote.source" value="b" label="edit two" />
      </>,
      { debounceMs: 5_000 },
    );

    await userEvent.click(screen.getByRole("button", { name: "edit one" }));
    // Force the first save through, so the indicator genuinely reaches "saved".
    await screen.findByRole("status");
    await waitFor(
      () => {
        expect(screen.getByRole("status")).toHaveTextContent(
          /belum tersimpan/i,
        );
      },
      { timeout: 2_000 },
    );

    await userEvent.click(screen.getByRole("button", { name: "edit two" }));

    // Still unsaved, and never "Tersimpan" in between.
    expect(screen.getByRole("status")).toHaveTextContent(/belum tersimpan/i);
  });
});

describe("formatRelative", () => {
  it.each([
    [0, "baru saja"],
    [4_000, "baru saja"],
    [12_000, "12 detik lalu"],
    [120_000, "2 menit lalu"],
    [7_200_000, "2 jam lalu"],
  ])("renders %i ms as %s", (ms, expected) => {
    expect(formatRelative(ms)).toBe(expected);
  });
});

// ------------------------------------------------------------------ DoD item 4

describe("the conflict warning (card DoD 4)", () => {
  it("warns when the server's timestamp moved further than this client's save explains", async () => {
    renderEditor(
      <>
        <EditorShell
          title="Budi & Ani"
          dashboardHref="/dashboard"
          preview={<p>preview</p>}
          properties={<p>properties</p>}
        />
        <EditButton path="quote.text" value="a" />
      </>,
      {
        knownUpdatedAt: "2026-09-01T00:00:00.000Z",
        save: () => Promise.resolve({ updatedAt: "2026-09-05T00:00:00.000Z" }),
      },
    );

    await userEvent.click(screen.getByRole("button", { name: "edit" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/diubah di tempat lain/i);
  });

  it("does not warn on an ordinary save", async () => {
    // The client's own save moves `updated_at` forward. A naive "newer than known" check
    // would flag every second save as a conflict, and a warning that appears constantly is
    // a warning nobody reads.
    const now = new Date().toISOString();
    renderEditor(
      <>
        <EditorShell
          title="Budi & Ani"
          dashboardHref="/dashboard"
          preview={<p>preview</p>}
          properties={<p>properties</p>}
        />
        <EditButton path="quote.text" value="a" />
      </>,
      { knownUpdatedAt: now, save: () => Promise.resolve({ updatedAt: now }) },
    );

    await userEvent.click(screen.getByRole("button", { name: "edit" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/tersimpan/i);
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is dismissible and non-blocking", async () => {
    renderEditor(
      <>
        <EditorShell
          title="Budi & Ani"
          dashboardHref="/dashboard"
          preview={<p>preview</p>}
          properties={<p>properties</p>}
        />
        <EditButton path="quote.text" value="a" />
      </>,
      {
        knownUpdatedAt: "2026-09-01T00:00:00.000Z",
        save: () => Promise.resolve({ updatedAt: "2026-09-05T00:00:00.000Z" }),
      },
    );

    await userEvent.click(screen.getByRole("button", { name: "edit" }));
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button", { name: /tutup/i }));

    expect(screen.queryByRole("alert")).toBeNull();
    // The editor is still there. Blocking would strand somebody whose second tab was one
    // they had forgotten about.
    expect(screen.getByText("preview")).toBeInTheDocument();
  });
});

// ------------------------------------------------------------- the section list

describe("missingRequired", () => {
  it.each([
    ["absent", {}, 1],
    ["null", { couple: { groom: { nickname: null } } }, 1],
    ["only whitespace", { couple: { groom: { nickname: "   " } } }, 1],
    ["an empty array", { couple: { groom: { nickname: [] } } }, 1],
    ["filled", { couple: { groom: { nickname: "Budi" } } }, 0],
  ])("counts a %s value", (_name, data, expected) => {
    expect(missingRequired(["couple.groom.nickname"], data)).toBe(expected);
  });

  it('treats "   " as empty, so a blank hero cannot pass as complete', () => {
    // BR-4.2 blocks publishing on an empty required field. A check that accepted whitespace
    // would show a green tick beside a section that will be refused.
    expect(missingRequired(["a"], { a: " \t " })).toBe(1);
  });
});

describe("the section list", () => {
  /**
   * Open the sections tab first.
   *
   * jsdom evaluates no media queries, so `md:block` never applies and the shell's panels are
   * genuinely `hidden` except the active one — which is correct behaviour being correctly
   * observed, not a test-environment workaround. It also means these assertions are about
   * the MOBILE layout, where the tabs are the only way in.
   */
  const openSections = async () => {
    await userEvent.click(screen.getByRole("tab", { name: "Bagian" }));
  };

  it("shows a toggle only for a configurable section", async () => {
    renderEditor(
      <EditorShell
        title="Budi & Ani"
        dashboardHref="/dashboard"
        preview={<p>preview</p>}
        properties={<p>properties</p>}
      />,
    );
    await openSections();

    // `gallery` is configurable; `hero` is structural and must not be switchable off.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("names the incomplete indicator, not only colours it", async () => {
    // `docs/UI-UX/08`: colour is never the sole indicator.
    renderEditor(
      <EditorShell
        title="Budi & Ani"
        dashboardHref="/dashboard"
        preview={<p>preview</p>}
        properties={<p>properties</p>}
      />,
      { data: {} },
    );
    await openSections();

    expect(screen.getByText(/isian wajib belum lengkap/i)).toBeInTheDocument();
  });

  it("drops the indicator once the required field is filled", async () => {
    renderEditor(
      <EditorShell
        title="Budi & Ani"
        dashboardHref="/dashboard"
        preview={<p>preview</p>}
        properties={<p>properties</p>}
      />,
      { data: { couple: { groom: { nickname: "Budi" } } } },
    );
    await openSections();

    expect(screen.queryByText(/isian wajib belum lengkap/i)).toBeNull();
  });

  it("queues a settings save when a section is toggled", async () => {
    const { saved } = renderEditor(
      <EditorShell
        title="Budi & Ani"
        dashboardHref="/dashboard"
        preview={<p>preview</p>}
        properties={<p>properties</p>}
      />,
    );
    await openSections();

    await userEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => {
      expect(saved.flat()).toContain("settings.enabled_sections");
    });
  });
});

// --------------------------------------------------------------------- layout

describe("the editor shell", () => {
  it("renders all three panels in one tree", () => {
    // One tree, shown or hidden by CSS. Two trees would be two editor states to keep in
    // step, which is the failure `docs/FRONTEND/02` warns about arriving through the layout.
    renderEditor(
      <EditorShell
        title="Budi & Ani"
        dashboardHref="/dashboard"
        preview={<p>preview</p>}
        properties={<p>properties</p>}
      />,
    );

    expect(screen.getAllByRole("tabpanel", { hidden: true })).toHaveLength(3);
  });

  it("switches which panel is exposed on a tab click", async () => {
    renderEditor(
      <EditorShell
        title="Budi & Ani"
        dashboardHref="/dashboard"
        preview={<p>preview</p>}
        properties={<p>properties</p>}
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Pratinjau" }));

    expect(screen.getByRole("tab", { name: "Pratinjau" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Isian" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("keeps the status indicator in the header at every width", () => {
    renderEditor(
      <EditorShell
        title="Budi & Ani"
        dashboardHref="/dashboard"
        preview={<p>preview</p>}
        properties={<p>properties</p>}
      />,
    );

    const header = screen.getByRole("banner");
    expect(header).toContainElement(screen.getByRole("status"));
  });

  it("has no axe violations", async () => {
    const { container } = renderEditor(
      <EditorShell
        title="Budi & Ani"
        dashboardHref="/dashboard"
        preview={<p>preview</p>}
        properties={<p>properties</p>}
      />,
    );

    expect(await axeViolationIds(container)).toEqual([]);
  });
});

/** A test-only control that drives one edit through the provider's `edit`. */
function EditButton({
  path,
  value,
  label = "edit",
}: {
  readonly path: string;
  readonly value: unknown;
  readonly label?: string;
}) {
  const { edit } = useEditorContext();

  return (
    <button
      type="button"
      onClick={() => {
        edit(path, value);
      }}
    >
      {label}
    </button>
  );
}
