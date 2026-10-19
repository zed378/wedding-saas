import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { GuestbookModerationList } from "../src/components/GuestbookModerationList";
import type { GuestbookItem, GuestbookSummary } from "../src/lib/invitations";

const MOCK_SUMMARY: GuestbookSummary = {
  total: 3,
  pending: 1,
  approved: 1,
  rejected: 1,
};

const MOCK_ENTRIES: readonly GuestbookItem[] = [
  {
    id: "gb-1",
    guest_name: "Rina Wijaya",
    message: "Barakallahu lakuma wa baraka alaikuma! Bahagia selalu untuk kedua mempelai.",
    status: "pending",
    created_at: "2026-10-18T14:00:00.000Z",
  },
  {
    id: "gb-2",
    guest_name: "Joko Anwar",
    message: "Selamat menempuh hidup baru!",
    status: "approved",
    created_at: "2026-10-18T15:00:00.000Z",
  },
];

describe("P4-11 — Owner Guestbook Moderation List", () => {
  it("renders tabs with category counts and explanation banner", () => {
    render(
      <GuestbookModerationList
        invitationId="inv-123"
        entries={MOCK_ENTRIES}
        summary={MOCK_SUMMARY}
        currentFilter="pending"
        onFilterChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/Ucapan dengan status/)).toBeDefined();
    expect(screen.getAllByText("Menunggu").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Disetujui").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Ditolak").length).toBeGreaterThanOrEqual(1);
  });

  it("handles 1-click approve action for pending entries", () => {
    const onModerate = vi.fn();

    render(
      <GuestbookModerationList
        invitationId="inv-123"
        entries={MOCK_ENTRIES}
        summary={MOCK_SUMMARY}
        currentFilter="pending"
        onFilterChange={vi.fn()}
        onModerate={onModerate}
      />,
    );

    const approveBtn = screen.getByLabelText("Setujui ucapan dari Rina Wijaya");
    fireEvent.click(approveBtn);

    expect(onModerate).toHaveBeenCalledWith("gb-1", "approved");
  });

  it("handles 1-click reject action for approved entries", () => {
    const onModerate = vi.fn();

    render(
      <GuestbookModerationList
        invitationId="inv-123"
        entries={MOCK_ENTRIES}
        summary={MOCK_SUMMARY}
        currentFilter="approved"
        onFilterChange={vi.fn()}
        onModerate={onModerate}
      />,
    );

    const rejectBtn = screen.getByLabelText("Tolak ucapan dari Joko Anwar");
    fireEvent.click(rejectBtn);

    expect(onModerate).toHaveBeenCalledWith("gb-2", "rejected");
  });

  it("handles delete with confirmation", () => {
    const onDelete = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <GuestbookModerationList
        invitationId="inv-123"
        entries={MOCK_ENTRIES}
        summary={MOCK_SUMMARY}
        currentFilter="all"
        onFilterChange={vi.fn()}
        onDelete={onDelete}
      />,
    );

    const deleteBtn = screen.getByLabelText("Hapus ucapan dari Rina Wijaya");
    fireEvent.click(deleteBtn);

    expect(window.confirm).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledWith("gb-1");
  });
});
