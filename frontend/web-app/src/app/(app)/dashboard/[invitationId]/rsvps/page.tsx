"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { useAuth } from "../../../../../lib/auth";
import { toFriendlyError } from "../../../../../lib/error-messages";
import {
  deleteInvitationRsvp,
  getInvitationRsvpSummary,
  listInvitationRsvps,
  type RsvpAttendanceStatus,
  type RsvpItem,
  type RsvpSummary,
} from "../../../../../lib/invitations";
import { RsvpTable } from "../../../../../components/RsvpTable";

type PageState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded" }
  | { readonly kind: "failed"; readonly message: string };

export default function RsvpsDashboardPage({
  params,
}: {
  readonly params:
    | Promise<{ readonly invitationId: string }>
    | { readonly invitationId: string };
}) {
  const { invitationId } = "then" in params ? use(params) : params;
  const { api } = useAuth();

  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [items, setItems] = useState<readonly RsvpItem[]>([]);
  const [summary, setSummary] = useState<RsvpSummary | undefined>(undefined);
  const [filter, setFilter] = useState<RsvpAttendanceStatus | "all">("all");
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    try {
      const [listRes, summaryRes] = await Promise.all([
        listInvitationRsvps(api, invitationId, {
          page,
          limit: 20,
          status: filter !== "all" ? filter : undefined,
        }),
        getInvitationRsvpSummary(api, invitationId),
      ]);

      setItems(listRes.items);
      setSummary(summaryRes);
      if (listRes.meta) {
        const total = listRes.meta.total;
        const perPage = listRes.meta.per_page;
        setTotalPages(Math.max(1, Math.ceil(total / perPage)));
      }
      setState({ kind: "loaded" });
    } catch (error) {
      setState({ kind: "failed", message: toFriendlyError(error).message });
    }
  }, [api, invitationId, page, filter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleDelete = async (rsvpId: string) => {
    await deleteInvitationRsvp(api, invitationId, rsvpId);
    await loadData();
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      // Export CSV via authenticated request using ApiClient
      const token = api.tokens.get();
      const headers: Record<string, string> = {};
      if (token) headers["authorization"] = `Bearer ${token}`;

      const baseUrl = process.env["NEXT_PUBLIC_API_BASE_URL"] ?? "http://localhost:3000/api/v1";
      const res = await fetch(`${baseUrl}/invitations/${encodeURIComponent(invitationId)}/rsvps/export`, {
        headers,
      });

      if (!res.ok) {
        throw new Error("Gagal mengunduh file CSV.");
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `rsvp-invitation-${invitationId.slice(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      alert(toFriendlyError(error).message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-text-muted">
        <ol className="flex items-center space-x-2">
          <li>
            <Link
              href="/dashboard"
              className="hover:text-text underline focus-ring rounded"
            >
              Dasbor
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-text font-medium" aria-current="page">
            Konfirmasi Kehadiran (RSVP)
          </li>
        </ol>
      </nav>

      {/* Header */}
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">
          Daftar Konfirmasi Kehadiran
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Pantau konfirmasi kehadiran dan jumlah tamu dari undangan digital Anda.
        </p>
      </header>

      {/* Content */}
      {state.kind === "loading" && (
        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border">
          <p className="text-sm text-text-muted">Memuat data konfirmasi RSVP...</p>
        </div>
      )}

      {state.kind === "failed" && (
        <div
          role="alert"
          className="rounded-lg border border-danger-200 bg-danger-50 p-6 text-center text-danger-900"
        >
          <h2 className="text-base font-semibold">Gagal Memuat RSVP</h2>
          <p className="mt-1 text-sm">{state.message}</p>
          <button
            type="button"
            onClick={() => void loadData()}
            className="focus-ring mt-4 inline-flex items-center rounded-md border border-danger-300 bg-white px-3 py-1.5 text-xs font-medium text-danger-800 shadow-sm hover:bg-danger-50"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {state.kind === "loaded" && (
        <RsvpTable
          invitationId={invitationId}
          rsvps={items}
          summary={summary}
          currentFilter={filter}
          onFilterChange={(newFilter) => {
            setFilter(newFilter);
            setPage(1);
          }}
          onDelete={handleDelete}
          onExportCsv={handleExportCsv}
          isExporting={isExporting}
          pagination={{
            page,
            totalPages,
            onPageChange: (newPage) => setPage(newPage),
          }}
        />
      )}
    </main>
  );
}
