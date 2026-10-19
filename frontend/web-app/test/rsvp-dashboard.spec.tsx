import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { RsvpTable } from "../src/components/RsvpTable";
import type { RsvpItem, RsvpSummary } from "../src/lib/invitations";

const MOCK_SUMMARY: RsvpSummary = {
  total: 4,
  attending: 2,
  not_attending: 1,
  tentative: 1,
  awaiting: 0,
  total_attending_guests: 5,
};

const MOCK_RSVPS: readonly RsvpItem[] = [
  {
    id: "rsvp-1",
    guest_name: "Budi Santoso",
    attendance_status: "attending",
    guest_count: 3,
    message: "Selamat menempuh hidup baru! Semoga bahagia selalu sampai akhir hayat.",
    created_at: "2026-10-18T10:00:00.000Z",
  },
  {
    id: "rsvp-2",
    guest_name: "Siti Rahma",
    attendance_status: "not_attending",
    guest_count: 1,
    message: "Mohon maaf belum bisa hadir karena dinas ke luar kota.",
    created_at: "2026-10-18T11:00:00.000Z",
  },
];

describe("P4-11 — Owner RSVP Table and Card Stack", () => {
  it("renders summary statistics in the header", () => {
    render(
      <RsvpTable
        invitationId="inv-123"
        rsvps={MOCK_RSVPS}
        summary={MOCK_SUMMARY}
        currentFilter="all"
        onFilterChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Total Respon")).toBeDefined();
    expect(screen.getByText("4")).toBeDefined();
    expect(screen.getByText("(5 tamu)")).toBeDefined();
    expect(screen.getAllByText("Tidak Hadir").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Ragu-ragu").length).toBeGreaterThanOrEqual(1);
  });

  it("renders mobile card stack and desktop table with guest details", () => {
    render(
      <RsvpTable
        invitationId="inv-123"
        rsvps={MOCK_RSVPS}
        summary={MOCK_SUMMARY}
        currentFilter="all"
        onFilterChange={vi.fn()}
      />,
    );

    // Guest names appear in both mobile and desktop views
    const budiElements = screen.getAllByText("Budi Santoso");
    expect(budiElements.length).toBeGreaterThanOrEqual(1);

    const sitiElements = screen.getAllByText("Siti Rahma");
    expect(sitiElements.length).toBeGreaterThanOrEqual(1);
  });

  it("toggles expand and collapse for long messages", () => {
    const longMessageRsvp: RsvpItem = {
      id: "rsvp-long",
      guest_name: "Ahmad Dani",
      attendance_status: "attending",
      guest_count: 2,
      message:
        "Selamat atas pernikahannya! Semoga menjadi keluarga yang sakinah, mawaddah, warahmah. Diberikan keturunan yang sholeh dan sholehah serta senantiasa dilimpahkan berkah dan rezeki berlimpah selamanya.",
      created_at: "2026-10-18T12:00:00.000Z",
    };

    render(
      <RsvpTable
        invitationId="inv-123"
        rsvps={[longMessageRsvp]}
        summary={MOCK_SUMMARY}
        currentFilter="all"
        onFilterChange={vi.fn()}
      />,
    );

    const expandButtons = screen.getAllByText("Lihat selengkapnya");
    expect(expandButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(expandButtons[0]!);
    expect(screen.getAllByText("Tutup").length).toBeGreaterThanOrEqual(1);
  });

  it("handles status filter changes and export button click", () => {
    const onFilterChange = vi.fn();
    const onExportCsv = vi.fn();

    render(
      <RsvpTable
        invitationId="inv-123"
        rsvps={MOCK_RSVPS}
        summary={MOCK_SUMMARY}
        currentFilter="all"
        onFilterChange={onFilterChange}
        onExportCsv={onExportCsv}
      />,
    );

    const attendingFilter = screen.getByRole("button", { name: "Hadir" });
    fireEvent.click(attendingFilter);
    expect(onFilterChange).toHaveBeenCalledWith("attending");

    const exportBtn = screen.getByRole("button", { name: "Ekspor CSV" });
    fireEvent.click(exportBtn);
    expect(onExportCsv).toHaveBeenCalled();
  });

  it("prompts for confirmation before deleting an RSVP", async () => {
    const onDelete = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <RsvpTable
        invitationId="inv-123"
        rsvps={MOCK_RSVPS}
        summary={MOCK_SUMMARY}
        currentFilter="all"
        onFilterChange={vi.fn()}
        onDelete={onDelete}
      />,
    );

    const deleteButtons = screen.getAllByLabelText("Hapus RSVP dari Budi Santoso");
    fireEvent.click(deleteButtons[0]!);

    expect(window.confirm).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledWith("rsvp-1");
  });
});
