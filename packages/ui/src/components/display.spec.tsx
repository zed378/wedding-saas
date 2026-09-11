import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { axeViolationIds } from "../testing/axe.js";
import {
  Badge,
  INVITATION_STATUS_PRESENTATION,
  InvitationStatusBadge,
  type InvitationStatus,
} from "./Badge.js";
import { Card, CardHeader } from "./Card.js";
import { InteractiveCard } from "./InteractiveCard.js";
import { Table } from "./Table.js";
import { Skeleton, SkeletonList } from "./Skeleton.js";
import { Avatar } from "./Avatar.js";

/**
 * P0-22 — the display components.
 *
 * The status badge tests carry the most weight. `docs/UI-UX/08` § Invitation Status
 * fixes a colour per status, `docs/DATABASE/04`'s CHECK constraint fixes the set of
 * statuses, and the DoD requires the map to exist in exactly one place. A status the
 * database can store but the map cannot render is a badge that throws on a real row.
 */

/**
 * The statuses, written out by hand.
 *
 * NOT derived from `INVITATION_STATUS_PRESENTATION`. That is the whole point: a list
 * generated from the map under test would still pass after someone deleted an entry
 * from both sides. This is the independent copy, taken from `docs/DATABASE/04`'s
 * `invitations_status_check`.
 */
const STATUSES_FROM_THE_DATABASE: readonly InvitationStatus[] = [
  "draft",
  "pending_payment",
  "paid",
  "published",
  "expired",
  "soft_deleted",
];

describe("InvitationStatusBadge", () => {
  it("renders every status the database CHECK constraint allows", () => {
    // If this fails, either the map lost a status or the database gained one. Both are
    // bugs and both are silent until a user with that status loads their dashboard.
    for (const status of STATUSES_FROM_THE_DATABASE) {
      expect(
        INVITATION_STATUS_PRESENTATION[status],
        `no presentation for "${status}"`,
      ).toBeDefined();
    }
  });

  it("maps each status to the tone docs/UI-UX/08 names", () => {
    // The document's table, transcribed. Written out rather than looped so a changed
    // row shows up as a specific failing line.
    expect(INVITATION_STATUS_PRESENTATION.draft.tone).toBe("neutral");
    expect(INVITATION_STATUS_PRESENTATION.pending_payment.tone).toBe("warning");
    expect(INVITATION_STATUS_PRESENTATION.paid.tone).toBe("info");
    expect(INVITATION_STATUS_PRESENTATION.published.tone).toBe("success");
    expect(INVITATION_STATUS_PRESENTATION.expired.tone).toBe("danger");
  });

  it("always renders a text label, never colour alone", () => {
    // docs/UI-UX/08 § Contrast & Accessibility: "Color is NEVER the sole indicator of
    // information ... important for color-blind users." There is deliberately no prop
    // to turn the label off.
    for (const status of STATUSES_FROM_THE_DATABASE) {
      const { unmount } = render(<InvitationStatusBadge status={status} />);
      const label = INVITATION_STATUS_PRESENTATION[status].label;

      expect(screen.getByText(label)).toBeInTheDocument();
      expect(label.trim().length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("degrades to a neutral badge naming the raw value for an unknown status", () => {
    // A build that predates a new status should not take the page down. It should look
    // obviously wrong to whoever sees it.
    render(<InvitationStatusBadge status={"archived" as InvitationStatus} />);
    expect(screen.getByText("archived")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <>
        {STATUSES_FROM_THE_DATABASE.map((status) => (
          <InvitationStatusBadge key={status} status={status} />
        ))}
        <Badge tone="premium">Premium</Badge>
      </>,
    );
    expect(await axeViolationIds(container)).toEqual([]);
  });
});

describe("Card", () => {
  it("renders its children inside a heading-led block", () => {
    render(
      <Card>
        <CardHeader title="Elegant Rose" description="Modern, floral" />
        <p>Rp 139.000</p>
      </Card>,
    );

    expect(
      screen.getByRole("heading", { name: "Elegant Rose" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Rp 139.000")).toBeInTheDocument();
  });

  it("makes an activatable card a real button, not a div with onClick", async () => {
    // A div with an onClick is unreachable by keyboard and invisible to a screen
    // reader, and it is the most common accessibility defect in a dashboard.
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <InteractiveCard label="Pilih template Elegant Rose" onClick={onClick}>
        <p>Elegant Rose</p>
      </InteractiveCard>,
    );

    const card = screen.getByRole("button", {
      name: "Pilih template Elegant Rose",
    });
    await user.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);

    // And by keyboard, with no key handler of our own.
    card.focus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <>
        <Card>
          <CardHeader title="Undangan" description="Draf" />
        </Card>
        <InteractiveCard label="Pilih Elegant Rose" onClick={() => {}}>
          <p>Elegant Rose</p>
        </InteractiveCard>
      </>,
    );
    expect(await axeViolationIds(container)).toEqual([]);
  });
});

interface Guest {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

const GUESTS: readonly Guest[] = [
  { id: "1", name: "Andi Pratama", count: 2 },
  { id: "2", name: "Rina Kusuma", count: 1 },
];

const COLUMNS = [
  {
    key: "name",
    header: "Nama tamu",
    render: (g: Guest) => g.name,
    sortable: true,
  },
  {
    key: "count",
    header: "Jumlah",
    render: (g: Guest) => g.count,
    numeric: true,
    sortable: true,
  },
];

describe("Table", () => {
  it("is a real table with a caption and column headers", () => {
    // A screen reader in table mode reads the header for the cell it lands on. A grid
    // of divs gives a wall of unrelated text -- which is the RSVP list's whole problem.
    render(
      <Table
        caption="Daftar RSVP"
        columns={COLUMNS}
        rows={GUESTS}
        rowKey={(g) => g.id}
      />,
    );

    const table = screen.getByRole("table", { name: "Daftar RSVP" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + 2
  });

  it("announces the sort state on the header cell", () => {
    render(
      <Table
        caption="Daftar RSVP"
        columns={COLUMNS}
        rows={GUESTS}
        rowKey={(g) => g.id}
        sort={{ key: "name", direction: "asc" }}
        onSortChange={() => {}}
      />,
    );

    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).toHaveAttribute("aria-sort", "ascending");
    expect(headers[1]).toHaveAttribute("aria-sort", "none");
  });

  it("sorts from the keyboard, because the header is a button", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    render(
      <Table
        caption="Daftar RSVP"
        columns={COLUMNS}
        rows={GUESTS}
        rowKey={(g) => g.id}
        sort={{ key: "name", direction: "asc" }}
        onSortChange={onSortChange}
      />,
    );

    const header = screen.getByRole("button", { name: /Nama tamu/ });
    header.focus();
    await user.keyboard("{Enter}");

    // Already ascending, so activating it asks for descending.
    expect(onSortChange).toHaveBeenCalledWith("name", "desc");
  });

  it("does not make a column sortable without a handler", () => {
    // Otherwise the header looks interactive and does nothing.
    render(
      <Table
        caption="Daftar RSVP"
        columns={COLUMNS}
        rows={GUESTS}
        rowKey={(g) => g.id}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says so when there is nothing to show", () => {
    render(
      <Table
        caption="Daftar RSVP"
        columns={COLUMNS}
        rows={[]}
        rowKey={(g: Guest) => g.id}
      />,
    );
    expect(screen.getByText("Belum ada data.")).toBeInTheDocument();
  });

  it("puts the scroll container in the tab order", () => {
    // WCAG 2.1 § 2.1.1: a scrollable region that cannot be focused is unreachable
    // without a mouse.
    render(
      <Table
        caption="Daftar RSVP"
        columns={COLUMNS}
        rows={GUESTS}
        rowKey={(g) => g.id}
      />,
    );
    expect(screen.getByRole("region", { name: "Daftar RSVP" })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Table
        caption="Daftar RSVP"
        columns={COLUMNS}
        rows={GUESTS}
        rowKey={(g) => g.id}
        sort={{ key: "name", direction: "asc" }}
        onSortChange={() => {}}
      />,
    );
    expect(await axeViolationIds(container)).toEqual([]);
  });
});

describe("Skeleton", () => {
  it("is hidden from assistive technology", () => {
    // A screen reader reading out six grey rectangles is worse than silence.
    const { container } = render(<Skeleton className="h-4 w-32" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("announces the loading state once, in words, for the whole block", () => {
    render(<SkeletonList rows={4} label="Memuat daftar undangan" />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(
      within(status).getByText("Memuat daftar undangan"),
    ).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <SkeletonList rows={3} label="Memuat daftar undangan" />,
    );
    expect(await axeViolationIds(container)).toEqual([]);
  });
});

describe("Avatar", () => {
  it("uses the person's name as the image's alt text", () => {
    // "avatar" and "profile picture" are the two most common useless alt texts on the
    // web, and both are what an optional prop produces.
    render(<Avatar name="Budi Santoso" src="https://example.test/b.webp" />);
    expect(
      screen.getByRole("img", { name: "Budi Santoso" }),
    ).toBeInTheDocument();
  });

  it("falls back to initials but still says the name", () => {
    render(<Avatar name="Budi Santoso" />);

    expect(screen.getByText("BS")).toBeInTheDocument();
    // The initials are the visual shorthand; the name is the information.
    expect(screen.getByText("Budi Santoso")).toBeInTheDocument();
  });

  it("does not split a surrogate pair when taking initials", () => {
    // `split("")[0]` on a name starting outside the BMP yields half a surrogate, which
    // renders as a replacement character rather than a letter.
    render(<Avatar name="𝐀ndi Pratama" />);
    expect(screen.getByText("𝐀P")).toBeInTheDocument();
  });

  it("survives a name that is only whitespace", () => {
    render(<Avatar name="   " />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("keeps the crop indicator out of the accessibility tree", () => {
    // It communicates something only a sighted user is deciding about.
    const { container } = render(
      <Avatar
        name="Budi"
        src="https://example.test/b.webp"
        showCropIndicator
      />,
    );
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(1);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <>
        <Avatar name="Budi Santoso" />
        <Avatar
          name="Siti Nurhaliza"
          src="https://example.test/s.webp"
          size="xl"
        />
      </>,
    );
    expect(await axeViolationIds(container)).toEqual([]);
  });
});
