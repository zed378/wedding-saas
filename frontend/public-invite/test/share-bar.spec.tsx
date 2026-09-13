import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ShareBar } from "../src/components/ShareBar";

/**
 * `P2-10` step 4 — share to WhatsApp, and copy the link.
 *
 * The behaviour worth testing is not that a link is rendered. It is **which** link: a
 * guest on a personalized address must not pass their own `?to=` on to the next person,
 * and a guest whose clipboard refuses must be told rather than left wondering.
 */

const CANONICAL = "https://invitation.test/andi-sarah";

const at = (href: string) => {
  window.history.replaceState({}, "", href);
};

beforeEach(() => {
  at("/andi-sarah");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A clipboard that resolves, and the calls it received. */
function stubClipboard(behaviour: "ok" | "reject" | "absent" = "ok") {
  const writeText = vi.fn(() =>
    behaviour === "reject"
      ? Promise.reject(new Error("not focused"))
      : Promise.resolve(),
  );

  vi.stubGlobal(
    "navigator",
    behaviour === "absent" ? {} : { clipboard: { writeText } },
  );

  return writeText;
}

describe("the WhatsApp link", () => {
  it("carries the invitation's address and an invitation message", async () => {
    render(<ShareBar coupleNames="Budi & Siti" url={CANONICAL} />);

    const link = await screen.findByRole("link", {
      name: /bagikan ke whatsapp/i,
    });
    const href = link.getAttribute("href") ?? "";

    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(href.slice("https://wa.me/?text=".length));
    expect(text).toContain("Budi & Siti");
    expect(text).toContain("/andi-sarah");
  });

  it("shares the canonical address, not the guest's personalized one", async () => {
    // The behaviour this component exists to get right. Forwarding a card addressed to
    // somebody else is exactly what a guest would not notice doing — so the URL comes
    // from the server as a prop and the address bar is never read.
    at("/andi-sarah?to=Dewi%20Lestari");

    render(<ShareBar coupleNames="Budi & Siti" url={CANONICAL} />);

    const link = await screen.findByRole("link", {
      name: /bagikan ke whatsapp/i,
    });

    expect(link.getAttribute("href")).not.toContain("Dewi");
    expect(link.getAttribute("href")).not.toContain("to%3D");
  });

  it("still invites when neither name is filled in", async () => {
    render(<ShareBar coupleNames={undefined} url={CANONICAL} />);

    const link = await screen.findByRole("link", {
      name: /bagikan ke whatsapp/i,
    });

    expect(link.getAttribute("href")).toContain("mengundang");
  });

  it("opens in a new tab without handing over the opener", async () => {
    render(<ShareBar coupleNames="Budi & Siti" url={CANONICAL} />);

    const link = await screen.findByRole("link", {
      name: /bagikan ke whatsapp/i,
    });

    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

describe("copying the link", () => {
  it("copies the canonical address, not the one in the address bar", async () => {
    at("/andi-sarah?to=Dewi");
    const writeText = stubClipboard();

    render(<ShareBar coupleNames="Budi & Siti" url={CANONICAL} />);
    await userEvent.click(
      screen.getByRole("button", { name: /salin tautan/i }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("/andi-sarah"),
      );
    });
    expect(writeText.mock.calls[0]?.[0]).not.toContain("Dewi");
  });

  it("announces success in a live region", async () => {
    // `docs/UI-UX/16` asks for brief feedback. A colour change tells a screen-reader user
    // nothing, and they are the person least able to check the clipboard another way.
    stubClipboard();

    render(<ShareBar coupleNames="Budi & Siti" url={CANONICAL} />);
    await userEvent.click(
      screen.getByRole("button", { name: /salin tautan/i }),
    );

    const status = await screen.findByRole("status");
    await waitFor(() => {
      expect(status.textContent).toMatch(/disalin/i);
    });
  });

  it("says so when the clipboard refuses", async () => {
    // It rejects when the document is not focused, and is absent entirely on an insecure
    // origin. Silence would look like the button did nothing.
    stubClipboard("reject");

    render(<ShareBar coupleNames="Budi & Siti" url={CANONICAL} />);
    await userEvent.click(
      screen.getByRole("button", { name: /salin tautan/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/tidak bisa/i);
    });
  });

  it("does not throw when there is no clipboard at all", async () => {
    stubClipboard("absent");

    render(<ShareBar coupleNames="Budi & Siti" url={CANONICAL} />);

    await expect(
      userEvent.click(screen.getByRole("button", { name: /salin tautan/i })),
    ).resolves.not.toThrow();
  });

  it("keeps the live region in the document from the start", () => {
    // A live region inserted at the moment it gains content is frequently not announced:
    // the screen reader has to have been observing it already.
    stubClipboard();
    render(<ShareBar coupleNames="Budi & Siti" url={CANONICAL} />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("keyboard access", () => {
  it("reaches both controls by tabbing", async () => {
    stubClipboard();
    render(<ShareBar coupleNames="Budi & Siti" url={CANONICAL} />);

    await userEvent.tab();
    expect(
      screen.getByRole("link", { name: /bagikan ke whatsapp/i }),
    ).toHaveFocus();

    await userEvent.tab();
    expect(screen.getByRole("button", { name: /salin tautan/i })).toHaveFocus();
  });

  it("copies on Enter", async () => {
    const writeText = stubClipboard();
    render(<ShareBar coupleNames="Budi & Siti" url={CANONICAL} />);

    screen.getByRole("button", { name: /salin tautan/i }).focus();
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
  });
});
