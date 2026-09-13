import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CoverGate } from "../src/components/CoverGate";

/**
 * `P2-10` step 5 — the cover gate.
 *
 * The behaviour that matters is what the gate does to the content it wraps, which is the
 * whole reason it exists here rather than in `HeroClassic`: `P2-03`'s button hid itself on
 * click and gated nothing.
 */

afterEach(() => {
  cleanup();
});

const Invitation = () => (
  <>
    <h1>Budi &amp; Siti</h1>
    <p>Masjid Agung Bandung</p>
    <a href="https://example.test">Lihat lokasi</a>
  </>
);

describe("before it is opened", () => {
  it("shows the control", () => {
    render(
      <CoverGate>
        <Invitation />
      </CoverGate>,
    );

    expect(
      screen.getByRole("button", { name: /buka undangan/i }),
    ).toBeInTheDocument();
  });

  it("keeps the whole invitation in the document", () => {
    /*
     * The property that must never break. A sharing bot reads the HTML
     * (`docs/FRONTEND/07`) and a screen reader reads the document, so removing the
     * invitation to achieve a visual effect would trade the product's distribution
     * mechanism for an animation.
     */
    render(
      <CoverGate>
        <Invitation />
      </CoverGate>,
    );

    expect(screen.getByRole("heading", { name: /budi/i })).toBeInTheDocument();
    expect(screen.getByText("Masjid Agung Bandung")).toBeInTheDocument();
  });

  it("clips the content rather than hiding it", () => {
    const { container } = render(
      <CoverGate>
        <Invitation />
      </CoverGate>,
    );

    const gate = container.querySelector("[data-cover-gate]");
    expect(gate?.getAttribute("data-open")).toBe("false");
    expect(gate?.className).toContain("overflow-hidden");
    // Not `hidden`, not `display:none`, not `aria-hidden`: each of those would take the
    // content out of the accessibility tree along with the view.
    expect(gate?.hasAttribute("hidden")).toBe(false);
    expect(gate?.getAttribute("aria-hidden")).toBeNull();
  });

  it("carries a noscript rule that releases the clip", () => {
    // Without JavaScript the button cannot work, and a guest would be stuck on a cover
    // with a dead control. The browser only parses this when scripting is off.
    const { container } = render(
      <CoverGate>
        <Invitation />
      </CoverGate>,
    );

    const noscript = container.querySelector("noscript");
    expect(noscript).not.toBeNull();
    expect(noscript?.textContent).toContain("max-height:none");
    expect(noscript?.textContent).toContain("[data-cover-gate-control]");
  });
});

describe("opening it", () => {
  it("releases the clip and removes the control", async () => {
    const { container } = render(
      <CoverGate>
        <Invitation />
      </CoverGate>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /buka undangan/i }),
    );

    await waitFor(() => {
      expect(
        container.querySelector("[data-cover-gate]")?.getAttribute("data-open"),
      ).toBe("true");
    });
    expect(
      container.querySelector("[data-cover-gate]")?.className,
    ).not.toContain("overflow-hidden");
    expect(screen.queryByRole("button", { name: /buka undangan/i })).toBeNull();
  });

  it("opens on Enter, so a keyboard reaches the invitation", async () => {
    render(
      <CoverGate>
        <Invitation />
      </CoverGate>,
    );

    screen.getByRole("button", { name: /buka undangan/i }).focus();
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /buka undangan/i }),
      ).toBeNull();
    });
  });

  it("does not leave focus stranded on the control it removed", async () => {
    /*
     * Activating the button unmounts it. Without moving focus deliberately, the browser
     * drops it to the top of the document — which is the one part the guest has already
     * read, and for a screen reader it means the invitation they just opened is announced
     * from the beginning of the page rather than from its content.
     */
    const { container } = render(
      <CoverGate>
        <Invitation />
      </CoverGate>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /buka undangan/i }),
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(
        container.querySelector("[data-cover-gate]"),
      );
    });
  });

  it("is programmatically focusable but not a tab stop", () => {
    const { container } = render(
      <CoverGate>
        <Invitation />
      </CoverGate>,
    );

    expect(
      container.querySelector("[data-cover-gate]")?.getAttribute("tabindex"),
    ).toBe("-1");
  });
});
