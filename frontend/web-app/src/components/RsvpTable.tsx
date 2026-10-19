"use client";

import { useState } from "react";
import type { RsvpAttendanceStatus, RsvpItem, RsvpSummary } from "../lib/invitations";
import { formatEventDate } from "@wi/schema";

export interface RsvpTableProps {
  readonly invitationId: string;
  readonly rsvps: readonly RsvpItem[];
  readonly summary: RsvpSummary | undefined;
  readonly currentFilter: RsvpAttendanceStatus | "all";
  readonly onFilterChange: (status: RsvpAttendanceStatus | "all") => void;
  readonly onDelete?: (rsvpId: string) => Promise<void> | void;
  readonly onExportCsv?: () => Promise<void> | void;
  readonly isExporting?: boolean;
  readonly pagination?: {
    readonly page: number;
    readonly totalPages: number;
    readonly onPageChange: (page: number) => void;
  };
}

function statusBadge(status: RsvpAttendanceStatus) {
  switch (status) {
    case "attending":
      return (
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
          Hadir
        </span>
      );
    case "not_attending":
      return (
        <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-800">
          Tidak Hadir
        </span>
      );
    case "maybe":
      return (
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          Ragu-ragu
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

export function RsvpTable({
  invitationId,
  rsvps,
  summary,
  currentFilter,
  onFilterChange,
  onDelete,
  onExportCsv,
  isExporting = false,
  pagination,
}: RsvpTableProps) {
  const [expandedMessages, setExpandedMessages] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async (rsvpId: string) => {
    if (!window.confirm("Apakah Anda yakin ingin menghapus data konfirmasi ini?")) {
      return;
    }
    setDeletingId(rsvpId);
    try {
      await onDelete?.(rsvpId);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <header
          aria-label="Ringkasan Konfirmasi RSVP"
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          <div className="rounded-lg border border-border bg-surface-raised p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
              Total Respon
            </p>
            <p className="mt-1 text-2xl font-bold text-text">{summary.total}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-800">
              Hadir
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-900">
                {summary.attending}
              </span>
              <span className="text-xs font-medium text-emerald-700">
                ({summary.total_attending_guests} tamu)
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-rose-800">
              Tidak Hadir
            </p>
            <p className="mt-1 text-2xl font-bold text-rose-900">
              {summary.not_attending}
            </p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-amber-800">
              Ragu-ragu
            </p>
            <p className="mt-1 text-2xl font-bold text-amber-900">
              {summary.tentative}
            </p>
          </div>
        </header>
      )}

      {/* Action Bar: Filter & Export */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label="Filter status kehadiran"
          className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-sunken p-1"
        >
          {(
            [
              ["all", "Semua"],
              ["attending", "Hadir"],
              ["not_attending", "Tidak Hadir"],
              ["maybe", "Ragu-ragu"],
            ] as const
          ).map(([key, label]) => {
            const active = currentFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onFilterChange(key)}
                aria-pressed={active}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-surface-raised text-text shadow-sm"
                    : "text-text-muted hover:text-text"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {onExportCsv && (
          <button
            type="button"
            onClick={() => void onExportCsv()}
            disabled={isExporting || rsvps.length === 0}
            className="focus-ring inline-flex items-center justify-center gap-2 rounded-md border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-text shadow-sm hover:bg-surface-sunken disabled:opacity-50"
          >
            {isExporting ? "Mengunduh..." : "Ekspor CSV"}
          </button>
        )}
      </div>

      {/* RSVP Content: Empty State */}
      {rsvps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-text-muted">
          <p className="text-sm">Belum ada data konfirmasi kehadiran yang sesuai.</p>
        </div>
      ) : (
        <>
          {/* Mobile View: Card Stack (<640px) */}
          <div className="space-y-3 sm:hidden" data-testid="rsvp-cards-mobile">
            {rsvps.map((rsvp) => {
              const isExpanded = expandedMessages.has(rsvp.id);
              const message = rsvp.message?.trim();
              const hasLongMessage = (message?.length ?? 0) > 80;

              return (
                <article
                  key={rsvp.id}
                  className="rounded-lg border border-border bg-surface-raised p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate font-semibold text-text">
                        {rsvp.guest_name}
                      </h4>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {formatTimestamp(rsvp.created_at)}
                      </p>
                    </div>
                    {statusBadge(rsvp.attendance_status)}
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-text-muted">
                    <span>
                      Jumlah:{" "}
                      <strong className="text-text font-medium">
                        {rsvp.guest_count} orang
                      </strong>
                    </span>
                    {onDelete && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(rsvp.id)}
                        disabled={deletingId === rsvp.id}
                        className="text-rose-600 hover:underline disabled:opacity-50"
                        aria-label={`Hapus RSVP dari ${rsvp.guest_name}`}
                      >
                        {deletingId === rsvp.id ? "Menghapus..." : "Hapus"}
                      </button>
                    )}
                  </div>

                  {message && (
                    <div className="mt-2.5 rounded bg-surface-sunken p-2.5 text-xs text-text">
                      <p className={!isExpanded && hasLongMessage ? "line-clamp-2" : ""}>
                        &ldquo;{message}&rdquo;
                      </p>
                      {hasLongMessage && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(rsvp.id)}
                          className="mt-1 font-medium text-primary-600 hover:underline"
                        >
                          {isExpanded ? "Tutup" : "Lihat selengkapnya"}
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {/* Desktop View: Table (>=640px) */}
          <div className="hidden overflow-hidden rounded-lg border border-border bg-surface-raised shadow-sm sm:block">
            <table className="min-w-full divide-y divide-border text-left text-sm">
              <thead className="bg-surface-sunken text-xs font-semibold uppercase tracking-wider text-text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Nama Tamu
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Kehadiran
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Jumlah
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Pesan / Ucapan
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Waktu
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    <span className="sr-only">Aksi</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rsvps.map((rsvp) => {
                  const isExpanded = expandedMessages.has(rsvp.id);
                  const message = rsvp.message?.trim();
                  const hasLongMessage = (message?.length ?? 0) > 60;

                  return (
                    <tr key={rsvp.id} className="hover:bg-surface-sunken/40">
                      <td className="whitespace-nowrap px-4 py-3.5 font-medium text-text">
                        {rsvp.guest_name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5">
                        {statusBadge(rsvp.attendance_status)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-text-muted">
                        {rsvp.guest_count} orang
                      </td>
                      <td className="max-w-xs px-4 py-3.5 text-text">
                        {message ? (
                          <div>
                            <p
                              className={
                                !isExpanded && hasLongMessage ? "line-clamp-1" : ""
                              }
                            >
                              {message}
                            </p>
                            {hasLongMessage && (
                              <button
                                type="button"
                                onClick={() => toggleExpand(rsvp.id)}
                                className="mt-0.5 text-xs font-medium text-primary-600 hover:underline"
                              >
                                {isExpanded ? "Tutup" : "Lihat selengkapnya"}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-text-muted italic">-</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-xs text-text-muted">
                        {formatTimestamp(rsvp.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-right text-xs">
                        {onDelete && (
                          <button
                            type="button"
                            onClick={() => void handleDelete(rsvp.id)}
                            disabled={deletingId === rsvp.id}
                            className="font-medium text-rose-600 hover:underline disabled:opacity-50"
                            aria-label={`Hapus RSVP dari ${rsvp.guest_name}`}
                          >
                            {deletingId === rsvp.id ? "Menghapus..." : "Hapus"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <nav
              aria-label="Navigasi Halaman RSVP"
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
        </>
      )}
    </div>
  );
}
