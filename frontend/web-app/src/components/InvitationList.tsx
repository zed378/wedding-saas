"use client";

import { useCallback, useEffect, useState } from "react";

import { SkeletonList } from "@wi/ui";

import { useAuth } from "../lib/auth";
import { toFriendlyError } from "../lib/error-messages";
import {
  FILTERABLE_STATUSES,
  listInvitations,
  type FilterableStatus,
  type InvitationSummary,
} from "../lib/invitations";
import { InvitationCard } from "./InvitationCard";
import { FormError } from "./AuthShell";

/**
 * P1-21 — the dashboard list. `docs/PLAN/04` § F2, `docs/UI-UX/04` (Budi and the organiser).
 *
 * ## The filter is why this screen exists
 *
 * `docs/UI-UX/04`'s wedding-organiser journey is somebody with a dozen clients who needs to
 * tell drafts from published invitations at a glance. Card step 2 asks for the filter for
 * that reason, and it is the difference between a list and a work queue.
 *
 * ## The empty state guides
 *
 * `docs/UI-UX/01` principle 7: "every empty state provides a clear call-to-action, not just
 * 'no data'". And the two empty states are different — a user with no invitations at all
 * needs an invitation, while a user whose *filter* matched nothing needs the filter cleared.
 * Showing the first message to the second user tells them to create something they already
 * have.
 */

export interface InvitationListProps {
  readonly publicHost: string;
  readonly createHref: string;
}

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly items: readonly InvitationSummary[] }
  | { readonly kind: "failed"; readonly message: string };

export function InvitationList({
  publicHost,
  createHref,
}: InvitationListProps) {
  const { api } = useAuth();
  const [filter, setFilter] = useState<FilterableStatus | "all">("all");
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(
    async (status: FilterableStatus | "all", signal: AbortSignal) => {
      setState({ kind: "loading" });
      try {
        const page = await listInvitations(api, {
          ...(status === "all" ? {} : { status }),
        });
        if (!signal.aborted) setState({ kind: "loaded", items: page.items });
      } catch (error) {
        if (!signal.aborted) {
          setState({ kind: "failed", message: toFriendlyError(error).message });
        }
      }
    },
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(filter, controller.signal);
    return () => {
      // A filter changed twice quickly must not have the slower response win and paint the
      // wrong list. The abort flag is checked before every setState above.
      controller.abort();
    };
  }, [filter, load]);

  return (
    <section aria-labelledby="invitations-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2
          id="invitations-heading"
          className="text-lg font-semibold text-text"
        >
          Undangan Anda
        </h2>

        <a
          className="focus-ring inline-flex items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-text-inverse hover:bg-primary-700"
          href={createHref}
        >
          Buat undangan
        </a>
      </div>

      {/*
       * A radio group, not a row of buttons. Exactly one filter is active at a time, which
       * is what a radio group means -- and it gets arrow-key navigation from the platform
       * rather than from code. `docs/UI-UX/17` asks for full keyboard operability.
       */}
      <div
        role="radiogroup"
        aria-label="Saring berdasarkan status"
        className="mb-4 flex flex-wrap gap-2"
      >
        {(["all", ...FILTERABLE_STATUSES] as const).map((value) => {
          const active = filter === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              className={
                active
                  ? "focus-ring rounded-full bg-primary-600 px-3 py-1.5 text-sm font-medium text-text-inverse"
                  : "focus-ring rounded-full border border-border px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-sunken"
              }
              onClick={() => {
                setFilter(value);
              }}
            >
              {LABELS[value]}
            </button>
          );
        })}
      </div>

      {state.kind === "loading" && (
        // `SkeletonList` carries its own `role="status"` and label, so there is no second
        // live region here: two would announce the same thing twice.
        <SkeletonList rows={3} label="Memuat daftar undangan" />
      )}

      {state.kind === "failed" && <FormError message={state.message} />}

      {state.kind === "loaded" && state.items.length === 0 && (
        <EmptyState
          filtered={filter !== "all"}
          createHref={createHref}
          onClear={() => {
            setFilter("all");
          }}
        />
      )}

      {state.kind === "loaded" && state.items.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {state.items.map((invitation) => (
            <InvitationCard
              key={invitation.id}
              invitation={invitation}
              publicHost={publicHost}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

const LABELS: Readonly<Record<FilterableStatus | "all", string>> = {
  all: "Semua",
  draft: "Draf",
  pending_payment: "Menunggu pembayaran",
  paid: "Sudah dibayar",
  published: "Terbit",
  expired: "Kedaluwarsa",
};

/**
 * `docs/UI-UX/01` principle 7 — an empty state that guides.
 *
 * Two of them, because the two situations need opposite advice: somebody with nothing needs
 * to create an invitation, and somebody whose filter matched nothing needs the filter gone.
 */
function EmptyState({
  filtered,
  createHref,
  onClear,
}: {
  readonly filtered: boolean;
  readonly createHref: string;
  readonly onClear: () => void;
}) {
  if (filtered) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-text">Tidak ada undangan dengan status ini.</p>
        <button
          type="button"
          className="focus-ring mt-4 rounded-md border border-border px-4 py-2 text-sm font-medium text-text hover:bg-surface-sunken"
          onClick={onClear}
        >
          Tampilkan semua undangan
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center">
      <h3 className="text-base font-medium text-text">
        Belum ada undangan di sini
      </h3>
      <p className="mt-2 text-sm text-text-muted">
        Pilih template, beri nama, dan undangan pertama Anda siap disusun.
      </p>
      <a
        className="focus-ring mt-4 inline-flex items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-text-inverse hover:bg-primary-700"
        href={createHref}
      >
        Buat undangan pertama Anda
      </a>
    </div>
  );
}
