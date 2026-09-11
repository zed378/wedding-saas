import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";

import { axeViolationIds } from "../testing/axe.js";
import { Button } from "./Button.js";
import { Modal } from "./Modal.js";
import { Tabs } from "./Tabs.js";
import { Stepper } from "./Stepper.js";

describe("Button", () => {
  it("calls its handler", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Simpan</Button>);

    await user.click(screen.getByRole("button", { name: "Simpan" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call its handler when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Simpan
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Simpan" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("swallows the click while loading but stays focusable", async () => {
    // The reason `loading` uses aria-disabled rather than the disabled attribute: a
    // disabled element loses focus, and a keyboard user who pressed Enter on submit
    // would be thrown to the top of the document with no idea what happened.
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Simpan
      </Button>,
    );

    const button = screen.getByRole("button", { name: /Simpan/ });
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();

    button.focus();
    expect(button).toHaveFocus();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it("announces that it is busy, in words", async () => {
    render(<Button loading>Simpan</Button>);

    const button = screen.getByRole("button", { name: /Simpan/ });
    expect(button).toHaveAttribute("aria-busy", "true");
    // The spinner is decoration; this is what a screen reader says.
    expect(within(button).getByText("Memuat")).toBeInTheDocument();
  });

  it("defaults to type=button so it cannot submit a form by accident", () => {
    // The default HTML type is `submit`. A "Cancel" button inside a form that submits
    // it is a bug people rediscover every few years.
    render(<Button>Batal</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("has no accessibility violations in any variant", async () => {
    const { container } = render(
      <>
        <Button variant="primary">Simpan</Button>
        <Button variant="secondary">Batal</Button>
        <Button variant="ghost">Lihat</Button>
        <Button variant="danger">Hapus</Button>
        <Button loading>Memproses</Button>
        <Button disabled>Nonaktif</Button>
      </>,
    );
    expect(await axeViolationIds(container)).toEqual([]);
  });
});

describe("Modal", () => {
  it("is a native dialog, so focus trapping and inertness come from the browser", () => {
    render(<Modal open onClose={() => {}} title="Hapus undangan?" />);
    // jsdom implements <dialog> well enough to assert the element and its openness.
    expect(screen.getByRole("dialog")).toBeInstanceOf(HTMLDialogElement);
  });

  it("is named by its title and described by its description", () => {
    render(
      <Modal
        open
        onClose={() => {}}
        title="Hapus undangan?"
        description="Tindakan ini tidak dapat dibatalkan."
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Hapus undangan?");
    expect(dialog).toHaveAccessibleDescription(
      "Tindakan ini tidak dapat dibatalkan.",
    );
  });

  it("is absent from the accessibility tree when closed", () => {
    render(<Modal open={false} onClose={() => {}} title="Tertutup" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes through the caller rather than closing itself", async () => {
    // The parent owns `open`. A dialog that closed itself would leave the parent's
    // state stale and the next `open` would do nothing.
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Konfirmasi" />);

    await user.click(screen.getByRole("button", { name: "Tutup" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has a close control with a word, not just an X", () => {
    render(<Modal open onClose={() => {}} title="Konfirmasi" />);
    expect(screen.getByRole("button", { name: "Tutup" })).toBeInTheDocument();
  });

  it("does not dismiss a form modal on a backdrop click", async () => {
    // Losing a half-filled form to a stray click is the kind of thing people remember
    // about a product.
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Ubah data" size="form">
        <p>isi</p>
      </Modal>,
    );

    await user.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dismisses a confirmation modal on a backdrop click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Hapus?" />);

    await user.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Modal
        open
        onClose={() => {}}
        title="Hapus undangan?"
        description="Tindakan ini tidak dapat dibatalkan."
        footer={<Button variant="danger">Hapus</Button>}
      >
        <p>Undangan dan seluruh datanya akan dihapus.</p>
      </Modal>,
    );
    expect(await axeViolationIds(container)).toEqual([]);
  });
});

const TAB_ITEMS = [
  { id: "couple", label: "Mempelai", content: <p>Data mempelai</p> },
  { id: "event", label: "Acara", content: <p>Data acara</p> },
  { id: "gallery", label: "Galeri", content: <p>Data galeri</p> },
];

function ControlledTabs({ initial = "couple" }: { readonly initial?: string }) {
  const [active, setActive] = useState(initial);
  return (
    <Tabs
      items={TAB_ITEMS}
      activeId={active}
      onChange={setActive}
      label="Bagian undangan"
    />
  );
}

describe("Tabs", () => {
  it("exposes the WAI-ARIA tab structure", () => {
    render(<ControlledTabs />);

    expect(
      screen.getByRole("tablist", { name: "Bagian undangan" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    // Only the selected panel exists; the others are hidden, which keeps their content
    // out of the accessibility tree AND out of the page source.
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("labels the panel with its tab", () => {
    render(<ControlledTabs />);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Mempelai");
  });

  it("keeps exactly one tab in the tab order", () => {
    // Roving tabindex. Ten tabs each reachable by Tab means ten presses to reach the
    // content the user actually wants.
    render(<ControlledTabs />);

    const inOrder = screen
      .getAllByRole("tab")
      .filter((tab) => tab.getAttribute("tabindex") === "0");
    expect(inOrder).toHaveLength(1);
    expect(inOrder[0]).toHaveAccessibleName("Mempelai");
  });

  it("moves between tabs with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<ControlledTabs />);

    screen.getByRole("tab", { name: "Mempelai" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Acara" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Data acara");
  });

  it("wraps at the end rather than dead-ending", async () => {
    const user = userEvent.setup();
    render(<ControlledTabs initial="gallery" />);

    screen.getByRole("tab", { name: "Galeri" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Mempelai" })).toHaveFocus();
  });

  it("jumps to the ends with Home and End", async () => {
    const user = userEvent.setup();
    render(<ControlledTabs initial="event" />);

    screen.getByRole("tab", { name: "Acara" }).focus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Galeri" })).toHaveFocus();

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Mempelai" })).toHaveFocus();
  });

  it("skips a disabled tab when arrowing", async () => {
    const user = userEvent.setup();
    const items = [
      TAB_ITEMS[0]!,
      { ...TAB_ITEMS[1]!, disabled: true },
      TAB_ITEMS[2]!,
    ];

    function Harness() {
      const [active, setActive] = useState("couple");
      return (
        <Tabs
          items={items}
          activeId={active}
          onChange={setActive}
          label="Bagian"
        />
      );
    }
    render(<Harness />);

    screen.getByRole("tab", { name: "Mempelai" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Galeri" })).toHaveFocus();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ControlledTabs />);
    expect(await axeViolationIds(container)).toEqual([]);
  });
});

const STEPS = [
  { id: "template", label: "Pilih template" },
  { id: "data", label: "Isi data" },
  { id: "publish", label: "Terbitkan" },
];

describe("Stepper", () => {
  it("is an ordered list inside a named navigation", () => {
    render(<Stepper steps={STEPS} current={1} label="Langkah pembuatan" />);

    const nav = screen.getByRole("navigation", { name: "Langkah pembuatan" });
    expect(within(nav).getByRole("list")).toBeInTheDocument();
    expect(within(nav).getAllByRole("listitem")).toHaveLength(3);
  });

  it("marks the current step with aria-current", () => {
    render(<Stepper steps={STEPS} current={1} label="Langkah" />);
    const current = screen.getByText(/Isi data/);
    expect(current).toHaveAttribute("aria-current", "step");
  });

  it("states each step's state in words, not only in colour", () => {
    // docs/UI-UX/08: "Color is NEVER the sole indicator of information".
    render(<Stepper steps={STEPS} current={1} label="Langkah" />);

    expect(screen.getByText("(selesai)")).toBeInTheDocument();
    expect(screen.getByText("(langkah saat ini)")).toBeInTheDocument();
    expect(screen.getByText("(belum dimulai)")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Stepper steps={STEPS} current={1} label="Langkah" />,
    );
    expect(await axeViolationIds(container)).toEqual([]);
  });
});
