"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { useAuth } from "../../../../../lib/auth";
import { toFriendlyError } from "../../../../../lib/error-messages";
import {
  getInvitationAnalytics,
  type InvitationAnalytics,
} from "../../../../../lib/invitations";

/**
 * P4-10 — `/dashboard/[invitationId]/analytics`. `docs/PLAN/14` § MVP.
 *
 * Honest owner analytics dashboard:
 * - Page opens (daily breakdown and total aggregate).
 * - Clear, honest labeling ("page opens", not "unique guests").
 * - RSVP response count and attendance status breakdown.
 * - Guestbook message count and moderation status breakdown.
 */

type PageState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly data: InvitationAnalytics }
  | { readonly kind: "failed"; readonly message: string };

export default function AnalyticsDashboardPage({
  params,
}: {
  readonly params:
    | Promise<{ readonly invitationId: string }>
    | { readonly invitationId: string };
}) {
  const { invitationId } = "then" in params ? use(params) : params;
  const { api } = useAuth();
  const [state, setState] = useState<PageState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const data = await getInvitationAnalytics(api, invitationId);
      setState({ kind: "loaded", data });
    } catch (error) {
      setState({ kind: "failed", message: toFriendlyError(error).message });
    }
  }, [api, invitationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-4 py-8">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-text-muted">
        <ol className="flex items-center space-x-2">
          <li>
            <Link href="/dashboard" className="hover:text-text underline focus-ring rounded">
              Dasbor
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-text font-medium">
            Statistik & Keterlibatan
          </li>
        </ol>
      </nav>

      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text">Statistik Undangan</h1>
          <p className="mt-1 text-sm text-text-muted">
            Ringkasan pembukaan halaman, kehadiran tamu (RSVP), dan buku ucapan.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          disabled={state.kind === "loading"}
          className="focus-ring rounded-md border border-border bg-surface-raised px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-sunken disabled:opacity-50"
        >
          {state.kind === "loading" ? "Memuat..." : "Segarkan"}
        </button>
      </div>

      {state.kind === "loading" && (
        <div aria-live="polite" className="space-y-4">
          <div className="h-40 animate-pulse rounded-lg bg-surface-sunken" />
          <div className="h-40 animate-pulse rounded-lg bg-surface-sunken" />
        </div>
      )}

      {state.kind === "failed" && (
        <div
          role="alert"
          className="rounded-lg border border-danger-300 bg-danger-50 p-4 text-sm text-danger-800"
        >
          <p className="font-semibold">Gagal memuat statistik</p>
          <p className="mt-1">{state.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 font-medium underline hover:no-underline"
          >
            Coba lagi
          </button>
        </div>
      )}

      {state.kind === "loaded" && (
        <div className="space-y-6">
          {/* Section 1: Page Views */}
          <section
            aria-labelledby="views-heading"
            className="rounded-xl border border-border bg-surface-raised p-6 shadow-xs"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="views-heading" className="text-lg font-semibold text-text">
                Buka Halaman
              </h2>
              <span className="text-xs font-medium text-text-muted">
                Pembaruan berkala (write-behind)
              </span>
            </div>

            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-extrabold tracking-tight text-text">
                {state.data.views.total}
              </span>
              <span className="text-sm font-medium text-text-muted">kali dibuka</span>
            </div>

            {/* Honest labeling note per DoD */}
            <div className="mt-3 rounded-md bg-surface-sunken p-3 text-xs text-text-muted">
              <p className="font-medium text-text">Catatan Kejujuran Metrik:</p>
              <p className="mt-0.5">
                Angka di atas adalah <strong>total berapa kali halaman dibuka</strong>, bukan
                jumlah orang atau tamu unik. Platform kami menjaga privasi tanpa menyimpan IP,
                cookie pengenal, atau data pribadi pengunjung pasif.
              </p>
            </div>

            {/* Daily Trend */}
            <div className="mt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Riwayat Kunjungan Harian
              </h3>

              {state.data.views.daily.length === 0 ? (
                <p className="mt-2 text-sm text-text-muted">Belum ada kunjungan tercatat.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {state.data.views.daily.slice(0, 14).map((entry) => {
                    const maxCount = Math.max(
                      1,
                      ...state.data.views.daily.map((d) => d.count),
                    );
                    const percent = Math.min(100, Math.round((entry.count / maxCount) * 100));

                    return (
                      <li key={entry.date} className="flex items-center gap-3 text-sm">
                        <span className="w-24 shrink-0 font-mono text-xs text-text-muted">
                          {entry.date}
                        </span>
                        <div
                          className="h-3 flex-1 overflow-hidden rounded-full bg-surface-sunken"
                          aria-hidden="true"
                        >
                          <div
                            className="h-full rounded-full bg-primary-600 transition-all"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <span className="w-12 text-right font-medium text-text">
                          {entry.count}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* Section 2: RSVP */}
          <section
            aria-labelledby="rsvp-heading"
            className="rounded-xl border border-border bg-surface-raised p-6 shadow-xs"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="rsvp-heading" className="text-lg font-semibold text-text">
                Konfirmasi Kehadiran (RSVP)
              </h2>
              <span className="text-sm font-medium text-text-muted">
                {state.data.rsvps.total_responses} respon diterima
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border bg-surface-sunken p-3">
                <span className="block text-xs font-medium text-text-muted">Hadir</span>
                <span className="mt-1 block text-2xl font-bold text-success-700">
                  {state.data.rsvps.attending}
                </span>
              </div>

              <div className="rounded-lg border border-border bg-surface-sunken p-3">
                <span className="block text-xs font-medium text-text-muted">Tidak Hadir</span>
                <span className="mt-1 block text-2xl font-bold text-text-muted">
                  {state.data.rsvps.not_attending}
                </span>
              </div>

              <div className="rounded-lg border border-border bg-surface-sunken p-3">
                <span className="block text-xs font-medium text-text-muted">Ragu-ragu</span>
                <span className="mt-1 block text-2xl font-bold text-warning-700">
                  {state.data.rsvps.maybe}
                </span>
              </div>

              <div className="rounded-lg border border-primary-200 bg-primary-50 p-3">
                <span className="block text-xs font-medium text-primary-800">
                  Total Tamu Hadir
                </span>
                <span className="mt-1 block text-2xl font-bold text-primary-900">
                  {state.data.rsvps.total_attending_guests}
                </span>
              </div>
            </div>
          </section>

          {/* Section 3: Guestbook */}
          <section
            aria-labelledby="guestbook-heading"
            className="rounded-xl border border-border bg-surface-raised p-6 shadow-xs"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="guestbook-heading" className="text-lg font-semibold text-text">
                Buku Tamu & Ucapan
              </h2>
              <span className="text-sm font-medium text-text-muted">
                {state.data.guestbook.total} pesan masuk
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border bg-surface-sunken p-3">
                <span className="block text-xs font-medium text-text-muted">Disetujui</span>
                <span className="mt-1 block text-2xl font-bold text-success-700">
                  {state.data.guestbook.approved}
                </span>
              </div>

              <div className="rounded-lg border border-border bg-surface-sunken p-3">
                <span className="block text-xs font-medium text-text-muted">
                  Menunggu Moderasi
                </span>
                <span className="mt-1 block text-2xl font-bold text-warning-700">
                  {state.data.guestbook.pending}
                </span>
              </div>

              <div className="rounded-lg border border-border bg-surface-sunken p-3">
                <span className="block text-xs font-medium text-text-muted">Ditolak</span>
                <span className="mt-1 block text-2xl font-bold text-danger-700">
                  {state.data.guestbook.rejected}
                </span>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
