import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TemplateRenderer } from "@wi/template-renderer";

/**
 * P2-02 DoD item 1, the other half — the public surface renders through the **same**
 * package the editor does.
 *
 * That sameness is the whole architectural claim of `docs/FRONTEND/04`: the editor's
 * preview is honest because it is not a second implementation. Two imports of one package
 * is what makes the claim checkable, and this is the second import.
 *
 * `P2-08` builds the page around it. What is asserted here is that the package resolves
 * and renders from this application — the integration risk, not the feature.
 */

const version = {
  sections: [
    {
      section_key: "hero",
      component: "HeroClassic",
      enabled_by_default: true,
      configurable: false,
      required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
    },
    {
      section_key: "gift",
      component: "GiftAccountList",
      enabled_by_default: true,
      configurable: true,
      required_fields: ["gift.accounts.*.account_number"],
    },
  ],
  theme: { colors: { primary: "#b76e79" } },
};

const data = {
  couple: { groom: { nickname: "Budi" }, bride: { nickname: "Siti" } },
  gift: { accounts: [{ account_number: "1234567890" }] },
};

describe("the public surface can render through the shared package", () => {
  it("renders in public mode", () => {
    render(
      <TemplateRenderer
        mode="public"
        invitationData={data}
        templateVersion={version}
      />,
    );

    const root = document.querySelector<HTMLElement>(
      "[data-template-renderer]",
    );
    // `public` is the mode where submissions are live and the view counter runs -- the
    // only mode in which either may happen (`docs/FRONTEND/04` § Mode Differences).
    expect(root?.getAttribute("data-mode")).toBe("public");
    expect(document.querySelector('[data-section="hero"]')).not.toBeNull();
  });

  it("omits a disabled section from the page source entirely", () => {
    // This surface is the reason that rule exists. A `display:none` gift section still
    // ships the couple's account numbers to every guest who views source.
    render(
      <TemplateRenderer
        mode="public"
        invitationData={data}
        enabledSections={["hero"]}
        templateVersion={version}
      />,
    );

    expect(document.body.innerHTML).not.toContain("1234567890");
  });
});
