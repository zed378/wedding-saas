import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { axeViolationIds } from "../testing/axe.js";
import { ToastProvider, useToast, type ToastVariant } from "./Toast.js";

/**
 * P0-22 — Toast.
 *
 * The two properties worth testing are both about not being ignorable and not being
 * rude: errors interrupt and stay, everything else waits and goes away.
 */

function Trigger({
  variant,
  message = "Tersimpan",
}: {
  readonly variant: ToastVariant;
  readonly message?: string;
}) {
  const { show } = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        show({ variant, message });
      }}
    >
      Picu
    </button>
  );
}

const renderWithProvider = (ui: React.ReactNode, autoDismissMs = 5000) =>
  render(<ToastProvider autoDismissMs={autoDismissMs}>{ui}</ToastProvider>);

describe("Toast", () => {
  it("shows the message it was given", async () => {
    const user = userEvent.setup();
    renderWithProvider(<Trigger variant="success" />);

    await user.click(screen.getByRole("button", { name: "Picu" }));
    expect(screen.getByText("Tersimpan")).toBeInTheDocument();
  });

  it("puts errors in an assertive region and everything else in a polite one", async () => {
    // Interrupting someone mid-sentence to say "saved" is rude and, done often enough,
    // is why people turn announcements off. Interrupting to say "payment failed" is
    // correct.
    const user = userEvent.setup();
    renderWithProvider(
      <>
        <Trigger variant="error" message="Pembayaran gagal" />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Picu" }));

    const assertive = screen.getByRole("alert", {
      name: "Pemberitahuan penting",
    });
    expect(assertive).toHaveAttribute("aria-live", "assertive");
    expect(assertive).toHaveTextContent("Pembayaran gagal");

    const polite = screen.getByRole("status", { name: "Pemberitahuan" });
    expect(polite).toHaveAttribute("aria-live", "polite");
    expect(polite).not.toHaveTextContent("Pembayaran gagal");
  });

  it("renders both live regions before any toast exists", () => {
    // A live region created at the moment its content arrives is frequently not
    // announced at all, because the browser has nothing to diff against.
    renderWithProvider(<Trigger variant="info" />);

    expect(
      screen.getByRole("alert", { name: "Pemberitahuan penting" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Pemberitahuan" }),
    ).toBeInTheDocument();
  });

  it("names the variant in words as well as in colour", async () => {
    const user = userEvent.setup();
    renderWithProvider(
      <Trigger variant="warning" message="Kuota hampir habis" />,
    );

    await user.click(screen.getByRole("button", { name: "Picu" }));
    // docs/UI-UX/08: colour is never the sole indicator.
    expect(screen.getByText("Peringatan:")).toBeInTheDocument();
  });

  it("can be dismissed by hand", async () => {
    const user = userEvent.setup();
    renderWithProvider(<Trigger variant="success" />);

    await user.click(screen.getByRole("button", { name: "Picu" }));
    await user.click(
      screen.getByRole("button", { name: "Tutup pemberitahuan" }),
    );

    expect(screen.queryByText("Tersimpan")).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProvider(<Trigger variant="success" />);
    await user.click(screen.getByRole("button", { name: "Picu" }));

    expect(await axeViolationIds(container)).toEqual([]);
  });
});

describe("Toast auto-dismiss", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const click = async (name: string) => {
    // userEvent installs its own timer advancement; with fake timers the plain
    // `fireEvent`-style path is simpler and does not fight it.
    const button = screen.getByRole("button", { name });
    await act(async () => {
      button.click();
    });
  };

  it("removes a success toast after the interval", async () => {
    renderWithProvider(<Trigger variant="success" />, 1000);
    await click("Picu");
    expect(screen.getByText("Tersimpan")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1001);
    });

    expect(screen.queryByText("Tersimpan")).not.toBeInTheDocument();
  });

  it("leaves an error toast on screen", async () => {
    // docs/FRONTEND/08 routes 5xx here. A message that disappears after four seconds is
    // a message someone can miss entirely, and the one class of message worth reading
    // is the one saying something went wrong.
    renderWithProvider(
      <Trigger variant="error" message="Terjadi kesalahan" />,
      1000,
    );
    await click("Picu");

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText("Terjadi kesalahan")).toBeInTheDocument();
  });
});
