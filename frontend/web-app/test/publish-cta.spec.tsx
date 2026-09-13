import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient, accessTokenStore } from "@wi/api-client";
import { axeViolationIds } from "@wi/ui/src/testing/axe.js";

import { AuthProvider } from "../src/lib/auth";
import { EditorProvider } from "../src/editor/EditorProvider";
import { PublishCta } from "../src/editor/PublishCta";
import type { TemplateDefinition } from "../src/editor/store";

/**
 * P2-06 steps 4 and 5 — the publish button and the checklist beside it.
 *
 * Two of the card's DoD items are only observable from a rendered tree:
 *
 *  - *"the publish button is visible and disabled, never hidden"* — `docs/UI-UX/12` says so
 *    in as many words, and the reason is that a user who cannot find the button concludes
 *    the product cannot publish rather than that their invitation is incomplete.
 *  - *"field paths never reach the user interface untranslated"* — `field-labels.spec.ts`
 *    proves every path has a label; this proves the component renders the label.
 *
 * The third DoD item covered here is the one the service test cannot see at all: that a
 * required field inside a **disabled** section does not block the button.
 */

const DEFINITION: TemplateDefinition = {
  sections: [
    {
      section_key: "couple",
      configurable: false,
      enabled_by_default: true,
      required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
    },
    {
      section_key: "gift",
      configurable: true,
      enabled_by_default: true,
      required_fields: ["gift.accounts.*.account_number"],
    },
  ],
  enabledSections: ["couple", "gift"],
};

/** Both names filled in, which is everything the `couple` section requires. */
const NAMED = {
  couple: {
    groom: { nickname: "Budi" },
    bride: { nickname: "Siti" },
  },
};

function renderCta(
  options: {
    data?: Record<string, unknown>;
    definition?: TemplateDefinition;
  } = {},
) {
  const client = new ApiClient({
    baseUrl: "http://api.test/v1",
    tokenStore: accessTokenStore,
    fetch: async () =>
      new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

  return render(
    <AuthProvider client={client} restoreSession={false}>
      <EditorProvider
        invitationId="i1"
        data={options.data ?? {}}
        templateDefinition={options.definition ?? DEFINITION}
        transport={{ save: async () => undefined }}
        debounceMs={10}
      >
        <PublishCta />
      </EditorProvider>
    </AuthProvider>,
  );
}

const publishButton = () => screen.getByRole("button", { name: "Terbitkan" });

beforeEach(() => {
  accessTokenStore.clear();
});

afterEach(() => {
  cleanup();
});

// ------------------------------------------------- DoD: visible, disabled, never hidden

describe("the publish button", () => {
  it("is in the document and disabled while a required field is empty", () => {
    renderCta();

    // `toBeVisible` and not only `toBeDisabled`: a disabled button that is also hidden
    // would pass a disabled-only assertion while failing the requirement completely.
    expect(publishButton()).toBeVisible();
    expect(publishButton()).toBeDisabled();
  });

  it("is enabled once every required field of every enabled section is filled", () => {
    renderCta({
      data: {
        ...NAMED,
        gift: { accounts: [{ account_number: "1234567890" }] },
      },
    });

    expect(publishButton()).toBeEnabled();
  });

  it("explains itself to a screen reader while disabled", () => {
    // A `title` tooltip is invisible to a screen reader and to a touch screen, which is
    // most of this product's users. `aria-describedby` is what makes the reason reachable.
    renderCta();

    const describedBy = publishButton().getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();

    const explanation = document.getElementById(describedBy as string);
    expect(explanation).not.toBeNull();
    expect(explanation?.textContent).toContain("mempelai");
  });

  it("drops the description once there is nothing left to explain", () => {
    renderCta({
      data: {
        ...NAMED,
        gift: { accounts: [{ account_number: "1234567890" }] },
      },
    });

    expect(publishButton()).not.toHaveAttribute("aria-describedby");
    expect(publishButton()).not.toHaveAttribute("title");
  });
});

// ------------------------------------------------------ DoD: a disabled section is not a blocker

describe("a section the couple turned off", () => {
  it("does not hold publishing back over a field it would have required", () => {
    // The card's first DoD item. The couple has no account number and is not incomplete:
    // they chose not to show the gift section, and refusing to publish would be refusing
    // the invitation they asked for.
    renderCta({
      data: NAMED,
      definition: { ...DEFINITION, enabledSections: ["couple"] },
    });

    expect(publishButton()).toBeEnabled();
  });

  it("still blocks on a NON-configurable section the enabled list omits", () => {
    // `couple` is `configurable: false`, so the template displays it whatever the settings
    // say and its required fields still apply. A settings row that omits it must not
    // become a way to publish an invitation with no names on it.
    renderCta({ data: {}, definition: { ...DEFINITION, enabledSections: [] } });

    expect(publishButton()).toBeDisabled();
  });
});

// --------------------------------------------------------- DoD: no path reaches the user

describe("the checklist", () => {
  it("names each missing field in Indonesian, with its section", async () => {
    const user = userEvent.setup();
    renderCta({ data: {} });

    await user.click(
      screen.getByRole("button", { name: /isian belum lengkap/ }),
    );

    expect(
      screen.getByText("Nama panggilan mempelai pria di bagian Mempelai"),
    ).toBeVisible();
    expect(
      screen.getByText("Nama panggilan mempelai wanita di bagian Mempelai"),
    ).toBeVisible();
  });

  it("contains no dot-notation path anywhere in its markup", () => {
    // Asserted over the rendered subtree rather than over one string, so a path leaking
    // through a `title`, a `key` rendered by accident or a future second list is caught
    // too.
    const { container } = renderCta({ data: {} });

    expect(container.innerHTML).not.toContain("couple.");
    expect(container.innerHTML).not.toContain("gift.accounts");
  });

  it("counts what is left, so the user knows the size of the job", () => {
    renderCta({ data: {} });

    // Two names plus the gift account.
    expect(
      screen.getByRole("button", { name: "3 isian belum lengkap" }),
    ).toBeVisible();
  });

  it("disappears entirely when the invitation is ready", () => {
    renderCta({
      data: {
        ...NAMED,
        gift: { accounts: [{ account_number: "1234567890" }] },
      },
    });

    expect(screen.queryByText(/isian belum lengkap/)).toBeNull();
  });

  it("has no axe violations in either state", async () => {
    const incomplete = renderCta({ data: {} });
    expect(await axeViolationIds(incomplete.container)).toEqual([]);
    cleanup();

    const ready = renderCta({
      data: {
        ...NAMED,
        gift: { accounts: [{ account_number: "1234567890" }] },
      },
    });
    expect(await axeViolationIds(ready.container)).toEqual([]);
  });
});
