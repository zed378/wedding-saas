import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiClient } from "@wi/api-client";

import { EditorShell } from "../src/editor/EditorShell";
import { PanelBoundary } from "../src/components/PanelBoundary";
import { EditorProvider, useEditorContext } from "../src/editor/EditorProvider";
import { getAtPath } from "../src/editor/store";
import { AuthProvider } from "../src/lib/auth";
import { accessTokenStore } from "../src/lib/auth";

/**
 * P2-04 DoD item 2 — "a preview crash in the editor leaves the form and local state
 * usable".
 *
 * ## Why this is the expensive failure
 *
 * On the public page a broken section costs a guest some content. Here it costs the
 * couple **work they have already done**: without a boundary, one bad render unmounts the
 * whole editor and takes the properties panel, the dirty-field set and every keystroke
 * not yet saved with it. `P1-22` went to some trouble to make sure a failed *save* never
 * loses a keystroke; an unhandled render error loses the same data by a different route,
 * and no amount of care in the save path would have helped.
 */

/**
 * The editor inside the providers it actually runs in.
 *
 * `EditorProvider` reads the API client from `useAuth`, so an editor test without an
 * `AuthProvider` throws before the boundary under test is even mounted — which is how
 * the first version of this file failed, in a way that looked like the boundary not
 * working.
 */
const DEFINITION = {
  sections: [
    {
      section_key: "couple",
      component: "CoupleProfile",
      enabled_by_default: true,
      configurable: true,
      required_fields: ["couple.groom.nickname"],
      optional_fields: [],
    },
  ],
  // Required by `TemplateDefinition`, and read by the header's publish button since
  // `P2-06`: a definition with no enabled list is not a shape the editor ever holds
  // (`EditorScreen` derives it, `store.ts` fills it in), so omitting it here made the
  // boundary tests fail on a state production cannot reach.
  enabledSections: ["couple"],
  theme: {},
  customizable_theme_keys: [],
};

function renderEditor(preview: React.ReactNode) {
  return renderEditorWith(preview, null);
}

function renderEditorWith(preview: React.ReactNode, sibling: React.ReactNode) {
  return render(renderEditorTree(preview, sibling));
}

function renderEditorTree(preview: React.ReactNode, sibling: React.ReactNode) {
  const client = new ApiClient({
    baseUrl: "http://api.test/v1",
    tokenStore: accessTokenStore,
    fetch: async () =>
      new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

  return (
    <AuthProvider client={client} restoreSession={false}>
      <EditorProvider
        invitationId="i1"
        data={{}}
        templateDefinition={DEFINITION}
        transport={{ save: async () => undefined }}
        debounceMs={10}
      >
        <>
          <EditorShell preview={preview} />
          {sibling}
        </>
      </EditorProvider>
    </AuthProvider>
  );
}

const Exploding = () => {
  throw new Error("preview render failed");
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React prints every boundary-caught error; expected here.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("the preview boundary", () => {
  it("keeps the rest of the editor when the preview throws", () => {
    renderEditor(<Exploding />);

    // The properties panel and the section list both survive. `docs/FRONTEND/08`: "the
    // user must still be able to edit".
    expect(screen.getByRole("tab", { name: /isian/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /bagian/i })).toBeInTheDocument();
  });

  it("says the preview failed and that the edits are safe", () => {
    renderEditor(<Exploding />);

    // Unlike the public page's section boundary, which renders nothing: here the person
    // looking at the screen IS the person who needs to know, and silence would read as
    // "the invitation is empty" — the more alarming of the two wrong conclusions.
    expect(screen.getByText(/pratinjau gagal/i)).toBeInTheDocument();
    expect(screen.getByText(/tetap tersimpan/i)).toBeInTheDocument();
  });

  it("announces politely, so it does not interrupt typing", () => {
    renderEditor(<Exploding />);

    // `role="status"` and not `alert`: an assertive announcement would cut across
    // whatever the user is in the middle of typing, which is the thing this boundary
    // exists to protect.
    //
    // Scoped to the preview panel. jsdom applies no CSS, so the `hidden` class the shell
    // uses for its inactive panels does nothing here and the save-status indicator is in
    // the tree too -- an unscoped query finds two.
    const preview = document.querySelector("#panel-preview")!;
    expect(preview.querySelector('[role="status"]')).not.toBeNull();
  });

  it("leaves unsaved local state intact", () => {
    // The sequence that matters, in order: the couple types something, and THEN the
    // preview crashes. The first attempt at this test set the field from inside the
    // subtree that was about to throw -- React discards that render, so the value never
    // landed and the test failed for a reason that had nothing to do with the boundary.
    //
    // Read through the context rather than imported: `P1-22` made the store per-provider
    // rather than a module singleton, so there is no global to inspect.
    let store: ReturnType<typeof useEditorContext>["store"] | undefined;

    function Probe() {
      store = useEditorContext().store;
      return null;
    }

    const { rerender } = renderEditorWith(<p>pratinjau</p>, <Probe />);

    act(() => {
      store?.getState().setField("couple.groom.nickname", "Budi");
    });

    rerender(renderEditorTree(<Exploding />, <Probe />));

    const after = store?.getState();
    expect(getAtPath(after?.data ?? {}, "couple.groom.nickname")).toBe("Budi");
    expect([...(after?.dirtyFields ?? [])]).toContain("couple.groom.nickname");
    // And the editor is still there to keep typing into.
    expect(screen.getByRole("tab", { name: /isian/i })).toBeInTheDocument();
  });

  it("still lets the user switch to the properties tab and type", async () => {
    const user = userEvent.setup();

    renderEditor(<Exploding />);

    // The functional claim, exercised rather than inferred: the editor is still an editor.
    await user.click(screen.getByRole("tab", { name: /isian/i }));
    expect(screen.getByRole("tab", { name: /isian/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("the boundary in isolation", () => {
  it("renders its children when nothing throws", () => {
    render(
      <PanelBoundary>
        <p>pratinjau</p>
      </PanelBoundary>,
    );

    expect(screen.getByText("pratinjau")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("reports the error to a caller that asked for it", () => {
    const onError = vi.fn();

    render(
      <PanelBoundary onError={onError}>
        <Exploding />
      </PanelBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});
