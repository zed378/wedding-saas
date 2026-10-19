"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { useAuth } from "../../../../../lib/auth";
import { toFriendlyError } from "../../../../../lib/error-messages";
import {
  deleteGuestbookEntry,
  getInvitationGuestbookSummary,
  listInvitationGuestbook,
  moderateGuestbookEntry,
  type GuestbookItem,
  type GuestbookStatus,
  type GuestbookSummary,
} from "../../../../../lib/invitations";
import { GuestbookModerationList } from "../../../../../components/GuestbookModerationList";

type PageState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded" }
  | { readonly kind: "failed"; readonly message: string };

export default function GuestbookDashboardPage({
  params,
}: {
  readonly params:
    | Promise<{ readonly invitationId: string }>
    | { readonly invitationId: string };
}) {
  const { invitationId } = "then" in params ? use(params) : params;
  const { api } = useAuth();

  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [entries, setEntries] = useState<readonly GuestbookItem[]>([]);
  const [summary, setSummary] = useState<GuestbookSummary | undefined>(undefined);
  const [filter, setFilter] = useState<GuestbookStatus | "all">("pending");
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);

  const loadData = useCallback(async () => {
    try {
      const [listRes, summaryRes] = await Promise.all([
        listInvitationGuestbook(api, invitationId, {
          page,
          limit: 20,
          status: filter !== "all" ? filter : undefined,
        }),
        getInvitationGuestbookSummary(api, invitationId),
      ]);

      setEntries(listRes.items);
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

  const handleModerate = async (
    entryId: string,
    status: "approved" | "rejected",
  ) => {
    await moderateGuestbookEntry(api, invitationId, entryId, status);
    await loadData();
  };

  const handleDelete = async (entryId: string) => {
    await deleteGuestbookEntry(api, invitationId, entryId);
    await loadData();
  };

  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-4 py-8">
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
            Buku Tamu & Ucapan
          </li>
        </ol>
      </nav>

      {/* Header */}
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">
          Moderasi Buku Tamu
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Kelola doa dan ucapan dari para tamu undangan sebelum ditampilkan ke publik.
        </p>
      </header>

      {/* Content */}
      {state.kind === "loading" && (
        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border">
          <p className="text-sm text-text-muted">Memuat data buku tamu...</p>
        </div>
      )}

      {state.kind === "failed" && (
        <div
          role="alert"
          className="rounded-lg border border-danger-200 bg-danger-50 p-6 text-center text-danger-900"
        >
          <h2 className="text-base font-semibold">Gagal Memuat Buku Tamu</h2>
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
        <GuestbookModerationList
          invitationId={invitationId}
          entries={entries}
          summary={summary}
          currentFilter={filter}
          onFilterChange={(newFilter) => {
            setFilter(newFilter);
            setPage(1);
          }}
          onModerate={handleModerate}
          onDelete={handleDelete}
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
