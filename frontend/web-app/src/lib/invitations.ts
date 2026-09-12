import type { ApiClient } from "@wi/api-client";
import type { InvitationStatus } from "@wi/ui";

/**
 * P1-21 — the dashboard's view of `docs/API/04`.
 *
 * Types and calls only. The components never touch the client directly, so the shape the
 * screens depend on is written down in one place and a contract change surfaces here rather
 * than in six components at once.
 */

/** One row of `GET /invitations`. `docs/API/04` § Invitation CRUD. */
export interface InvitationSummary {
  readonly id: string;
  readonly internal_name: string | null;
  readonly status: InvitationStatus;
  readonly slug: string | null;
  readonly template_id: string;
  readonly published_at: string | null;
  readonly expiry_date: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  /** `docs/UI-UX/10` § InvitationCard: "the nearest event date". */
  readonly nearest_event_date?: string | null;
  readonly cover_thumbnail_url?: string | null;
}

export interface InvitationPage {
  readonly items: readonly InvitationSummary[];
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
}

/** The statuses a user may filter by, in the order the dashboard shows them. */
export const FILTERABLE_STATUSES = [
  "draft",
  "pending_payment",
  "paid",
  "published",
  "expired",
] as const satisfies readonly InvitationStatus[];

export type FilterableStatus = (typeof FILTERABLE_STATUSES)[number];

export async function listInvitations(
  api: ApiClient,
  options: { status?: FilterableStatus | undefined; page?: number } = {},
): Promise<InvitationPage> {
  const result = await api.request<InvitationSummary[]>("/invitations", {
    query: {
      ...(options.status !== undefined ? { status: options.status } : {}),
      ...(options.page !== undefined ? { page: options.page } : {}),
    },
  });

  return {
    items: result.data,
    page: result.meta?.page ?? 1,
    perPage: result.meta?.per_page ?? result.data.length,
    total: result.meta?.total ?? result.data.length,
  };
}

/** `GET /invitations/slug-available`. Advisory — see ADR-057. */
export interface SlugAvailability {
  readonly available: boolean;
  readonly slug: string;
  readonly reason?: "format" | "blocked" | "taken";
  readonly message?: string;
}

export async function checkSlug(
  api: ApiClient,
  slug: string,
  signal?: AbortSignal,
): Promise<SlugAvailability> {
  const result = await api.request<SlugAvailability>(
    "/invitations/slug-available",
    { query: { slug }, ...(signal !== undefined ? { signal } : {}) },
  );
  return result.data;
}

export interface CreatedInvitation {
  readonly id: string;
  readonly slug: string | null;
  readonly status: string;
  readonly template_id: string;
  readonly template_version_id: string;
}

export async function createInvitation(
  api: ApiClient,
  input: {
    templateId: string;
    internalName: string;
    slug?: string | undefined;
  },
): Promise<CreatedInvitation> {
  const result = await api.request<CreatedInvitation>("/invitations", {
    method: "POST",
    body: {
      template_id: input.templateId,
      internal_name: input.internalName,
      ...(input.slug !== undefined && input.slug.length > 0
        ? { slug: input.slug }
        : {}),
    },
  });
  return result.data;
}

/**
 * The client-side slug rules, mirroring `backend/api/src/modules/invitation/slug.service.ts`.
 *
 * **A mirror, not the authority.** `docs/PLAN/10` § Subdomain defines the format and the
 * server enforces it; this exists so a user learns they typed a capital letter while they are
 * typing rather than after a round trip. The blocklist is deliberately NOT mirrored — it
 * lives in a table an admin edits without a deploy (`docs/SECURITY/10`), so a copy here would
 * be wrong the first time somebody added a word.
 *
 * Card step 5: "mirroring the server rules, while treating the server as authoritative".
 */
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 50;
const SLUG_FORMAT = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/;

export function localSlugProblem(slug: string): string | undefined {
  if (slug.length === 0) return undefined;

  if (slug.length < SLUG_MIN_LENGTH) {
    return `Alamat minimal ${String(SLUG_MIN_LENGTH)} karakter.`;
  }
  if (slug.length > SLUG_MAX_LENGTH) {
    return `Alamat maksimal ${String(SLUG_MAX_LENGTH)} karakter.`;
  }
  if (!SLUG_FORMAT.test(slug)) {
    return "Gunakan huruf kecil, angka dan tanda hubung; tidak diawali atau diakhiri tanda hubung.";
  }
  return undefined;
}

/**
 * A first suggestion from the couple's own words.
 *
 * Only a starting point: the user edits it freely and the server decides. Producing one at
 * all matters because an empty address field is the step people abandon — `docs/UI-UX/04`'s
 * Budi journey is somebody doing this on a phone at eleven at night.
 */
export function suggestSlug(from: string): string {
  return (
    from
      .toLowerCase()
      .normalize("NFD")
      // Strip combining marks, so "Café" becomes "cafe" rather than losing the letter.
      .replace(/[\u0300-\u036F]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SLUG_MAX_LENGTH)
      .replace(/-+$/, "")
  );
}
