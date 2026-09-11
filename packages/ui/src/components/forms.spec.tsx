import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { axeViolationIds } from "../testing/axe.js";
import { Input } from "./Input.js";
import { Textarea } from "./Textarea.js";
import { Select } from "./Select.js";
import { Dropzone } from "./Dropzone.js";

/**
 * P0-22 — the form controls.
 *
 * `docs/UI-UX/06` § Usage Rules requires every component to carry default, hover, focus,
 * active, disabled, loading and error states. Hover and active are pure CSS and are
 * covered by the token test and the E2E axe pass over the real workbench; what is tested
 * here is everything a user or a screen reader can *observe*: association, invalid
 * state, described-by wiring, and disabled behaviour.
 *
 * Each control also gets an axe pass, so a lost label fails in this file rather than
 * once someone assembles a page.
 */

describe("Input", () => {
  it("associates its label with the control", async () => {
    // The whole reason Field exists. `getByLabelText` fails unless the association is
    // real -- it does not match a nearby <div> that looks like a label.
    render(<Input label="Nama panggilan" />);
    expect(screen.getByLabelText("Nama panggilan")).toBeInstanceOf(
      HTMLInputElement,
    );
  });

  it("keeps the label for assistive technology when it is visually hidden", () => {
    render(<Input label="Cari" labelHidden />);
    expect(screen.getByLabelText("Cari")).toBeInTheDocument();
  });

  it("announces helper text through aria-describedby", async () => {
    render(<Input label="Slug" helperText="Huruf kecil dan tanda hubung" />);
    expect(screen.getByLabelText("Slug")).toHaveAccessibleDescription(
      "Huruf kecil dan tanda hubung",
    );
  });

  it("marks an invalid field and announces why", () => {
    // docs/UI-UX/08: colour is never the only signal. aria-invalid is the state and the
    // message is the reason; both reach a screen reader.
    render(<Input label="Email" error="Format email tidak valid" />);

    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Format email tidak valid");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Format email tidak valid",
    );
  });

  it("announces both the helper text and the error when both are present", () => {
    // The helper says what is wanted; the error says what was wrong with the attempt.
    // Dropping either leaves the user guessing.
    render(
      <Input
        label="Slug"
        helperText="Huruf kecil saja"
        error="Sudah dipakai"
      />,
    );
    expect(screen.getByLabelText("Slug")).toHaveAccessibleDescription(
      "Huruf kecil saja Sudah dipakai",
    );
  });

  it("says a required field is required without reading out an asterisk", () => {
    render(<Input label="Nama" required />);
    const input = screen.getByLabelText(/Nama/);
    expect(input).toBeRequired();
    // The asterisk is aria-hidden; the words are what is announced.
    expect(screen.getByText("(wajib diisi)")).toBeInTheDocument();
  });

  it("does not accept input when disabled", async () => {
    const user = userEvent.setup();
    render(<Input label="Nama" disabled />);

    const input = screen.getByLabelText("Nama");
    await user.type(input, "abc");
    expect(input).toHaveValue("");
  });

  it("gives every instance a distinct id", () => {
    // Two controls sharing an id means one label points at the wrong control -- and it
    // only shows up when a form has two of the same field, which is most forms.
    render(
      <>
        <Input label="Nama depan" />
        <Input label="Nama belakang" />
      </>,
    );

    const first = screen.getByLabelText("Nama depan");
    const second = screen.getByLabelText("Nama belakang");
    expect(first.id).not.toBe(second.id);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Input label="Nama" helperText="Nama lengkap" required />,
    );
    expect(await axeViolationIds(container)).toEqual([]);
  });

  it("has no accessibility violations in its error state", async () => {
    const { container } = render(<Input label="Email" error="Tidak valid" />);
    expect(await axeViolationIds(container)).toEqual([]);
  });
});

describe("Textarea", () => {
  it("associates its label and reports invalid state", () => {
    render(<Textarea label="Pesan" error="Terlalu panjang" />);
    const control = screen.getByLabelText("Pesan");
    expect(control).toBeInstanceOf(HTMLTextAreaElement);
    expect(control).toHaveAttribute("aria-invalid", "true");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Textarea label="Pesan" helperText="Maksimal 500 karakter" />,
    );
    expect(await axeViolationIds(container)).toEqual([]);
  });
});

const PROVINCES = [
  { value: "jabar", label: "Jawa Barat" },
  { value: "jateng", label: "Jawa Tengah" },
  { value: "jatim", label: "Jawa Timur" },
];

describe("Select", () => {
  it("is a native select, so the platform picker and keyboard both work", () => {
    render(<Select label="Provinsi" options={PROVINCES} />);
    expect(screen.getByLabelText("Provinsi")).toBeInstanceOf(HTMLSelectElement);
  });

  it("renders every option", () => {
    render(<Select label="Provinsi" options={PROVINCES} />);
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("adds a placeholder option when asked", () => {
    render(
      <Select
        label="Provinsi"
        options={PROVINCES}
        placeholder="Pilih provinsi"
      />,
    );
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("filters the list when searchable", async () => {
    const user = userEvent.setup();
    render(<Select label="Provinsi" options={PROVINCES} searchable />);

    await user.type(screen.getByLabelText("Cari pilihan"), "timur");

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Jawa Timur");
  });

  it("announces how many options survived the filter", async () => {
    // A keyboard user narrowing a long list should not be typing into silence.
    const user = userEvent.setup();
    render(<Select label="Provinsi" options={PROVINCES} searchable />);

    await user.type(screen.getByLabelText("Cari pilihan"), "jawa");
    expect(screen.getByLabelText("Cari pilihan")).toHaveAccessibleDescription(
      "3 dari 3 pilihan",
    );
  });

  it("has no accessibility violations, searchable or not", async () => {
    const plain = render(<Select label="Provinsi" options={PROVINCES} />);
    expect(await axeViolationIds(plain.container)).toEqual([]);

    const searchable = render(
      <Select label="Kota" options={PROVINCES} searchable />,
    );
    expect(await axeViolationIds(searchable.container)).toEqual([]);
  });
});

describe("Dropzone", () => {
  it("is a real file input, not a div with a click handler", () => {
    // The single decision that makes it keyboard-operable, screen-reader-visible and
    // able to open the camera on a phone.
    render(<Dropzone label="Foto galeri" onFiles={() => {}} />);

    const input = screen.getByLabelText("Foto galeri");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(input).toHaveAttribute("type", "file");
  });

  it("is visually hidden rather than display:none, so it stays focusable", () => {
    // `display: none` removes it from the accessibility tree and the tab order, which
    // would make the whole control mouse-only.
    render(<Dropzone label="Foto" onFiles={() => {}} />);
    expect(screen.getByLabelText("Foto")).toHaveClass("sr-only");
  });

  it("reports the files a user picks", async () => {
    const user = userEvent.setup();
    const onFiles = vi.fn();
    render(<Dropzone label="Foto" onFiles={onFiles} />);

    const file = new File(["x"], "prewedding.webp", { type: "image/webp" });
    await user.upload(screen.getByLabelText("Foto"), file);

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0]![0]).toHaveLength(1);
  });

  it("exposes upload progress as a progressbar with a name", () => {
    render(<Dropzone label="Foto" onFiles={() => {}} progress={42} />);

    const bar = screen.getByRole("progressbar", { name: "Mengunggah Foto" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
  });

  it("clamps a progress value outside 0-100 rather than overflowing the bar", () => {
    render(<Dropzone label="Foto" onFiles={() => {}} progress={140} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.firstElementChild).toHaveStyle({ width: "100%" });
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Dropzone
        label="Foto galeri"
        helperText="Maksimal 5 MB per foto"
        accept="image/jpeg,image/png,image/webp"
        onFiles={() => {}}
        progress={10}
      />,
    );
    expect(await axeViolationIds(container)).toEqual([]);
  });
});
