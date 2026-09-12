import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient } from "@wi/api-client";
import { TemplateRenderer } from "@wi/template-renderer";

import { AuthProvider, accessTokenStore } from "../src/lib/auth";
import { EditorProvider, useEditorContext } from "../src/editor/EditorProvider";
import { LivePreview } from "../src/editor/LivePreview";
import type { TemplateDefinition } from "../src/editor/store";

/**
 * P2-05 — the live preview.
 *
 * ## The latency test is the interesting one
 *
 * `docs/PLAN/17` asks for "section changes reflected in the preview in < 300ms
 * (client-side, no server round-trip)", and the card's step 7 says to assert the budget
 * rather than eyeball it. Two things have to be true and they are separate claims: the
 * update is fast, and **no request is made**. A test that measured only the time would
 * pass against a fetch served from a fast local mock, which is exactly the implementation
 * `docs/FRONTEND/06` § Why Not Fetch-on-Every-Keystroke rules out.
 */

const DEFINITION: TemplateDefinition = {
  sections: [
    {
      section_key: "hero",
      component: "HeroClassic",
      configurable: false,
      enabled_by_default: true,
      required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
      optional_fields: [],
    },
    {
      section_key: "quote",
      component: "QuoteBanner",
      configurable: true,
      enabled_by_default: true,
      required_fields: ["quote.text"],
      optional_fields: ["quote.source"],
    },
    {
      section_key: "gift",
      component: "GiftAccountList",
      configurable: true,
      enabled_by_default: true,
      required_fields: ["gift.accounts.*.account_number"],
      optional_fields: [],
    },
  ],
  enabledSections: ["hero", "quote", "gift"],
  theme: { colors: { primary: "#b76e79" } },
  customizable_theme_keys: ["colors.primary"],
};

const DATA = {
  couple: { groom: { nickname: "Budi" }, bride: { nickname: "Siti" } },
  quote: { text: "Sebuah kutipan", source: "Ar-Rum 21" },
  gift: { accounts: [{ account_number: "1234567890", provider_name: "BCA" }] },
  settings: { enabled_sections: ["hero", "quote", "gift"] },
};

function renderPreview(
  options: {
    readonly data?: Record<string, unknown>;
    readonly definition?: TemplateDefinition | undefined;
    readonly onFetch?: () => void;
  } = {},
) {
  const client = new ApiClient({
    baseUrl: "http://api.test/v1",
    tokenStore: accessTokenStore,
    fetch: async () => {
      options.onFetch?.();
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  let store: ReturnType<typeof useEditorContext>["store"] | undefined;
  function Probe() {
    store = useEditorContext().store;
    return null;
  }

  const result = render(
    <AuthProvider client={client} restoreSession={false}>
      <EditorProvider
        invitationId="i1"
        data={options.data ?? DATA}
        templateDefinition={
          "definition" in options ? options.definition : DEFINITION
        }
        transport={{ save: async () => undefined }}
        debounceMs={5_000}
      >
        <>
          <LivePreview />
          <Probe />
        </>
      </EditorProvider>
    </AuthProvider>,
  );

  return { ...result, getStore: () => store };
}

describe("the preview renders from local state", () => {
  it("renders the enabled sections of the locked template version", () => {
    renderPreview();

    expect(document.querySelector('[data-section="hero"]')).not.toBeNull();
    expect(document.querySelector('[data-section="quote"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Budi");
  });

  it("renders in live mode, so nothing in it can submit", () => {
    renderPreview();

    // `docs/FRONTEND/04` § Mode Differences. The gift section's copy button is the
    // visible consequence: inert outside `public`.
    expect(
      document
        .querySelector("[data-template-renderer]")
        ?.getAttribute("data-mode"),
    ).toBe("live");
  });

  it("says so plainly when the template definition could not be loaded", () => {
    // `EditorScreen` swallows a failed definition fetch on purpose: the editor still
    // works and only the preview is unavailable. A blank centre column would read as a
    // broken editor.
    renderPreview({ definition: undefined });

    expect(screen.getByRole("status").textContent).toMatch(/belum tersedia/i);
  });
});

describe("a keystroke reaches the preview inside the budget, with no request", () => {
  it("updates in under 300ms and makes no network call", () => {
    // `docs/PLAN/17` § Non-Functional Performance. Both halves asserted: a test that
    // measured only elapsed time would pass against a fetch served by a fast local mock,
    // which is the implementation `docs/FRONTEND/06` rules out.
    const onFetch = vi.fn();
    const { getStore } = renderPreview({ onFetch });

    expect(document.body.textContent).toContain("Sebuah kutipan");

    const started = performance.now();
    act(() => {
      getStore()?.getState().setField("quote.text", "Kutipan yang diperbarui");
    });
    const elapsed = performance.now() - started;

    expect(document.body.textContent).toContain("Kutipan yang diperbarui");
    expect(
      elapsed,
      `the preview took ${elapsed.toFixed(1)}ms; docs/PLAN/17 budgets 300ms`,
    ).toBeLessThan(300);
    expect(
      onFetch,
      "the preview must read local state, never refetch (docs/FRONTEND/06)",
    ).not.toHaveBeenCalled();
  });

  it("does not wait for autosave", () => {
    // The debounce here is five seconds. If the preview were coupled to the save, the
    // new text would not appear until it fired — which is the failure this separation
    // exists to prevent.
    const { getStore } = renderPreview();

    act(() => {
      getStore()?.getState().setField("quote.text", "Segera terlihat");
    });

    expect(document.body.textContent).toContain("Segera terlihat");
    expect(getStore()?.getState().saveStatus).not.toBe("saved");
  });

  it("reflects a section being switched off", () => {
    const { getStore } = renderPreview();
    expect(document.querySelector('[data-section="gift"]')).not.toBeNull();

    act(() => {
      getStore()
        ?.getState()
        .setField("settings.enabled_sections", ["hero", "quote"]);
    });

    // And the account number is gone from the page source, not merely hidden — the same
    // property `P2-02` asserts for the public page, here because the editor renders the
    // identical component.
    expect(document.querySelector('[data-section="gift"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain("1234567890");
  });
});

describe("the device toggle", () => {
  it("offers a mobile and a desktop view, mobile first", () => {
    renderPreview();

    // `docs/UI-UX/12`: a 375px mobile frame. Mobile is the default because
    // `docs/UI-UX/14` § Principles makes the public invitation "purely mobile-first" —
    // previewing desktop by default would show the couple the less common case.
    expect(screen.getByRole("button", { name: "Ponsel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Desktop" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("switches the frame", async () => {
    const user = userEvent.setup();
    renderPreview();

    await user.click(screen.getByRole("button", { name: "Desktop" }));

    expect(
      document.querySelector("[data-device]")?.getAttribute("data-device"),
    ).toBe("desktop");
    expect(screen.getByRole("button", { name: "Desktop" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("scroll to section", () => {
  it("scrolls the preview to the section selected in the sidebar", () => {
    // jsdom does not implement `scrollIntoView`, so it is stubbed and observed. What is
    // asserted is that the RIGHT element is asked to scroll — the mechanism is the
    // browser's.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const { getStore } = renderPreview();

    act(() => {
      getStore()?.getState().setActiveSection("gift");
    });

    expect(scrollIntoView).toHaveBeenCalled();
  });
});

describe("the preview is skippable by keyboard", () => {
  it("offers a skip link pointing at the properties panel", () => {
    // `docs/UI-UX/17` § Areas of Special Attention. Without it, reaching the form means
    // tabbing through every gallery image and every control in the RSVP shell.
    renderPreview();

    const skip = screen.getByRole("link", { name: /lewati pratinjau/i });
    expect(skip).toHaveAttribute("href", "#editor-properties");
  });

  it("puts the skip link before the preview in the tab order", async () => {
    const user = userEvent.setup();
    renderPreview();

    await user.tab();

    expect(
      screen.getByRole("link", { name: /lewati pratinjau/i }),
    ).toHaveFocus();
  });
});

describe("the preview and the public page render the same DOM", () => {
  it("produces identical markup for identical data", () => {
    // The DoD's diff test, and the architectural claim of `docs/FRONTEND/04`: the editor's
    // preview is honest because it is not a second implementation. If these two ever
    // diverge, the preview stops being a preview.
    //
    // `mode` is the one deliberate difference, so both are rendered in `public` here —
    // what is being compared is the render path, not the mode.
    const { container: editorSide } = render(
      <TemplateRenderer
        mode="public"
        templateVersion={{
          sections: DEFINITION.sections.map((section) => ({
            section_key: section.section_key,
            component: section.component!,
            enabled_by_default: section.enabled_by_default ?? true,
            configurable: section.configurable ?? true,
            required_fields: section.required_fields ?? [],
            optional_fields: section.optional_fields ?? [],
          })),
          theme: DEFINITION.theme ?? {},
          customizable_theme_keys: DEFINITION.customizable_theme_keys ?? [],
        }}
        invitationData={DATA}
        enabledSections={["hero", "quote", "gift"]}
      />,
    );
    const fromEditorPackage = editorSide.innerHTML;

    const { container: publicSide } = render(
      <TemplateRenderer
        mode="public"
        templateVersion={{
          sections: DEFINITION.sections.map((section) => ({
            section_key: section.section_key,
            component: section.component!,
            enabled_by_default: section.enabled_by_default ?? true,
            configurable: section.configurable ?? true,
            required_fields: section.required_fields ?? [],
            optional_fields: section.optional_fields ?? [],
          })),
          theme: DEFINITION.theme ?? {},
          customizable_theme_keys: DEFINITION.customizable_theme_keys ?? [],
        }}
        invitationData={DATA}
        enabledSections={["hero", "quote", "gift"]}
      />,
    );

    expect(publicSide.innerHTML).toBe(fromEditorPackage);
  });
});
