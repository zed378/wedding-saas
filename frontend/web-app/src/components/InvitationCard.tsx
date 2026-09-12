"use client";

import { InvitationStatusBadge } from "@wi/ui";

import type { InvitationSummary } from "../lib/invitations";

/**
 * P1-21 — one invitation in the dashboard list. `docs/UI-UX/10` § InvitationCard.
 *
 * The card's props are that specification, field for field: thumbnail, internal name, status
 * badge, slug when published, the nearest event date, and the actions.
 *
 * ## The badge is not rendered here
 *
 * `InvitationStatusBadge` from `@wi/ui` owns the colour and the label, and the card DoD says
 * so: "status badge colours come from the design system map, not local conditionals". A
 * `status === "published" ? "green" : …` written in this file would be the second place the
 * mapping lives, and the two would disagree the first time `docs/UI-UX/08`'s table changed.
 *
 * ## Cards, not table rows
 *
 * `docs/UI-UX/15` asks for the list to stack on mobile rather than scroll sideways. This is
 * an `<li>` containing a heading and links — it is already a card at every width, and the
 * grid above it is what changes. That is the cheaper direction: a table that becomes cards
 * needs two markup trees and two accessibility stories.
 */

export interface InvitationCardProps {
  readonly invitation: InvitationSummary;
  /** The public host, for the address line. From configuration, never a literal. */
  readonly publicHost: string;
  readonly onDelete?: (invitation: InvitationSummary) => void;
}

/** `2027-06-12` → `12 Juni 2027`, in the user's language rather than ISO. */
function formatDate(iso: string | null | undefined): string | undefined {
  if (iso === null || iso === undefined || iso.length === 0) return undefined;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;

  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    // The stored value is a date, not an instant. Formatting it in the browser's zone would
    // show 11 June to somebody west of the wedding.
    timeZone: "UTC",
  }).format(date);
}

export function InvitationCard({
  invitation,
  publicHost,
  onDelete,
}: InvitationCardProps) {
  const name = invitation.internal_name ?? "Undangan tanpa nama";
  const eventDate = formatDate(invitation.nearest_event_date);
  const published = invitation.status === "published";

  return (
    <li className="rounded-lg border border-border bg-surface-raised p-4">
      <div className="flex gap-4">
        {invitation.cover_thumbnail_url != null ? (
          // eslint-disable-next-line @next/next/no-img-element -- the URL is a CDN host
          // resolved at runtime; Next's loader needs a build-time allowlist that P2-07 adds.
          <img
            src={invitation.cover_thumbnail_url}
            alt=""
            className="h-16 w-16 shrink-0 rounded-md object-cover"
          />
        ) : (
          // Decorative placeholder, so the row keeps its shape while a photo is processing.
          // `aria-hidden` because there is nothing here to describe.
          <div
            aria-hidden="true"
            className="h-16 w-16 shrink-0 rounded-md bg-surface-sunken"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-medium text-text">{name}</h3>
            <InvitationStatusBadge status={invitation.status} />
          </div>

          {published && invitation.slug !== null && (
            <p className="mt-1 truncate text-sm text-text-muted">
              <a
                className="focus-ring underline"
                href={`${publicHost}/${invitation.slug}`}
                // A published invitation opens on another origin. `noreferrer` keeps the
                // dashboard URL out of its referrer header -- an invitation id in a
                // referrer is a private identifier on a public page.
                target="_blank"
                rel="noreferrer"
              >
                {`${publicHost.replace(/^https?:\/\//, "")}/${invitation.slug}`}
              </a>
            </p>
          )}

          {eventDate !== undefined && (
            <p className="mt-1 text-sm text-text-muted">{eventDate}</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          className="focus-ring rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-sunken"
          href={`/editor/${invitation.id}`}
          /*
           * The accessible name carries the invitation, because a screen-reader user hearing
           * "Edit, Edit, Edit" down a list of twelve cannot tell them apart.
           *
           * `aria-label` rather than a visually hidden span: an accessible name assembled
           * from sibling text nodes is joined WITHOUT a separator by some accname
           * implementations — jsdom produces "EditRina & Joko" — and the ones that do insert
           * a space do it by convention rather than by specification. The label starts with
           * the visible text, which is what WCAG 2.5.3 Label in Name asks for.
           */
          aria-label={`Edit ${name}`}
        >
          Edit
        </a>

        {published && invitation.slug !== null && (
          <a
            className="focus-ring rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-sunken"
            href={`${publicHost}/${invitation.slug}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`Lihat ${name}`}
          >
            Lihat
          </a>
        )}

        {onDelete !== undefined && (
          <button
            type="button"
            className="focus-ring rounded-md border border-border px-3 py-1.5 text-sm font-medium text-danger-700 hover:bg-danger-50"
            aria-label={`Hapus ${name}`}
            onClick={() => {
              onDelete(invitation);
            }}
          >
            Hapus
          </button>
        )}
      </div>
    </li>
  );
}
