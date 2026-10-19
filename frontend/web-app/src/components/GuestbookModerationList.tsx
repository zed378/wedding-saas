"use client";

import { useState } from "react";
import type {
  GuestbookItem,
  GuestbookStatus,
  GuestbookSummary,
} from "../lib/invitations";
import { formatEventDate } from "@wi/schema";

export interface GuestbookModerationListProps {
  readonly invitationId: string;
  readonly entries: readonly GuestbookItem[];
  readonly summary: GuestbookSummary | undefined;
  readonly currentFilter: GuestbookStatus | "all";
  readonly onFilterChange: (status: GuestbookStatus | "all") => void;
  readonly onModerate?: (
    entryId: string,
    status: "approved" | "rejected",
  ) => Promise<void> | void;
  readonly onDelete?: (entryId: string) => Promise<void> | void;
  readonly pagination?: {
    readonly page: number;
    readonly totalPages: number;
    readonly onPageChange: (page: number) => void;
  };
}

function statusBadge(status: GuestbookStatus) {
  switch (status) {
    case "pending":
      return (
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          Menunggu
        </span>
      );
    case "approved":
      return (
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
          Disetujui
        </span>
      );
    case "rejected":
      return (
        <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-800">
          Ditolak
        </span>
      );
  }
}

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    const datePart = formatEventDate(isoString.slice(0, 10));
    const timePart = date.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${datePart}, ${timePart} WIB`;
  } catch {
    return isoString;
  }
}

export function GuestbookModerationList({
  invitationId,
  entries,
  summary,
  currentFilter,
  onFilterChange,
  onModerate,
  onDelete,
  pagination,
}: GuestbookModerationListProps) {
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  const handleModerate = async (
    entryId: string,
    status: "approved" | "rejected",
  ) => {
    setActiveActionId(entryId);
    try {
      await onModerate?.(entryId, status);
    } finally {
      setActiveActionId(null);
    }
  };

  const handleDelete = async (entryId: string) => {
    if (!window.confirm("Apakah Anda yakin ingin menghapus ucapan ini?")) {
      return;
    }
    setActiveActionId(entryId);
    try {
      await onDelete?.(entryId);
    } finally {
      setActiveActionId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Moderation Explanation Banner */}
      <div className="rounded-lg border border-border bg-surface-sunken p-4 text-xs text-text-muted">
        <p>
          Ucapan dengan status <strong className="text-emerald-700">Disetujui</strong>{" "}
          akan langsung tampil di buku tamu undangan Anda. Ucapan{" "}
          <strong className="text-amber-700">Menunggu</strong> membutuhkan persetujuan
          sebelum dapat dilihat oleh publik.
        </p>
      </div>

      {/* Filter Tabs with Badges */}
      <div
        role="tablist"
        aria-label="Filter status moderasi buku tamu"
        className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-sunken p-1"
      >
        {(
          [
            ["pending", "Menunggu", summary?.pending],
            ["approved", "Disetujui", summary?.approved],
            ["rejected", "Ditolak", summary?.rejected],
            ["all", "Semua", summary?.total],
          ] as const
        ).map(([key, label, count]) => {
          const active = currentFilter === key;
          return (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => onFilterChange(key)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-surface-raised text-text shadow-sm"
                  : "text-text-muted hover:text-text"
              }`}
            >
              <span>{label}</span>
              {count !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                    active
                      ? "bg-primary-100 text-primary-800"
                      : "bg-surface-sunken text-text-muted"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Entry List */}
      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-text-muted">
          <p className="text-sm">Tidak ada ucapan pada kategori ini.</p>
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Daftar ucapan buku tamu">
          {entries.map((entry) => {
            const isProcessing = activeActionId === entry.id;

            return (
              <li
                key={entry.id}
                className="rounded-lg border border-border bg-surface-raised p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 className="font-semibold text-text">{entry.guest_name}</h4>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {formatTimestamp(entry.created_at)}
                    </p>
                  </div>
                  {statusBadge(entry.status)}
                </div>

                <div className="mt-3 rounded-md bg-surface-sunken p-3 text-sm text-text">
                  <p className="whitespace-pre-wrap">&ldquo;{entry.message}&rdquo;</p>
                </div>

                {/* 1-Click Action Controls */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/50">
                  <div className="flex flex-wrap gap-2">
                    {entry.status !== "approved" && onModerate && (
                      <button
                        type="button"
                        onClick={() => void handleModerate(entry.id, "approved")}
                        disabled={isProcessing}
                        className="focus-ring rounded border border-emerald-600 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                        aria-label={`Setujui ucapan dari ${entry.guest_name}`}
                      >
                        Setujui
                      </button>
                    )}
                    {entry.status !== "rejected" && onModerate && (
                      <button
                        type="button"
                        onClick={() => void handleModerate(entry.id, "rejected")}
                        disabled={isProcessing}
                        className="focus-ring rounded border border-amber-600 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                        aria-label={`Tolak ucapan dari ${entry.guest_name}`}
                      >
                        Tolak
                      </button>
                    )}
                  </div>

                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(entry.id)}
                      disabled={isProcessing}
                      className="text-xs font-medium text-rose-600 hover:underline disabled:opacity-50"
                      aria-label={`Hapus ucapan dari ${entry.guest_name}`}
                    >
                      {isProcessing ? "Memproses..." : "Hapus"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <nav
          aria-label="Navigasi Halaman Buku Tamu"
          className="flex items-center justify-between border-t border-border pt-4"
        >
          <button
            type="button"
            onClick={() => pagination.onPageChange(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className="focus-ring rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-sunken disabled:opacity-50"
          >
            Sebelumnya
          </button>
          <span className="text-xs text-text-muted">
            Halaman {pagination.page} dari {pagination.totalPages}
          </span>
          <button
            type="button"
            onClick={() => pagination.onPageChange(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
            className="focus-ring rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-sunken disabled:opacity-50"
          >
            Berikutnya
          </button>
        </nav>
      )}
    </div>
  );
}
