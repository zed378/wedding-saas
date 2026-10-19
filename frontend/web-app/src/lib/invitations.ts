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

/** A template the create wizard can offer. `docs/API/03` § `GET /templates`. */
export interface TemplateChoice {
  readonly id: string;
  readonly name: string;
  /** `P2-14`: the change-template dialog reads the target's sections by slug. */
  readonly slug: string;
}

/**
 * `P2-11` — the templates a new invitation may choose, for the create wizard.
 *
 * `P1-21` left the wizard with `templates={[]}` and a comment saying the catalogue API did
 * not exist yet. It does (`P2-01`), and an empty list meant a user arriving without
 * `?template=` saw "Belum ada template yang tersedia" on a product that has templates.
 *
 * `anonymous`: the catalogue reads carry no session (ADR-059), and sending one would tie a
 * public, cacheable call to a user for no reason.
 */
export async function listTemplateChoices(
  api: ApiClient,
): Promise<readonly TemplateChoice[]> {
  const result = await api.request<
    { id: string; name: string; slug: string }[]
  >("/templates", {
    query: { per_page: 100 },
    anonymous: true,
  });

  return result.data.map((template) => ({
    id: template.id,
    name: template.name,
    slug: template.slug,
  }));
}

/** What the change-template confirmation needs from a template. `docs/API/03` § detail. */
export interface TemplateShape {
  readonly sections: readonly { readonly section_key: string }[];
  readonly customizable_theme_keys: readonly string[];
}

/** `GET /templates/:slug` — the newest published version, which is what a change locks. */
export async function getTemplateShape(
  api: ApiClient,
  slug: string,
): Promise<TemplateShape> {
  const result = await api.request<{
    current_version: {
      sections: unknown;
      customizable_theme_keys: readonly string[];
    };
  }>(`/templates/${encodeURIComponent(slug)}`, { anonymous: true });

  const version = result.data.current_version;
  return {
    sections: Array.isArray(version.sections)
      ? (version.sections as { section_key: string }[])
      : [],
    customizable_theme_keys: version.customizable_theme_keys,
  };
}

/** `POST /invitations/:id/change-template`. `docs/API/04` § change-template response. */
export interface TemplateChangeResult {
  readonly template_id: string;
  readonly template_version_id: string;
  readonly enabled_sections: readonly string[];
  readonly hidden_sections: readonly string[];
  readonly dropped_theme_keys: readonly string[];
}

export async function changeTemplate(
  api: ApiClient,
  invitationId: string,
  templateId: string,
): Promise<TemplateChangeResult> {
  const result = await api.request<TemplateChangeResult>(
    `/invitations/${encodeURIComponent(invitationId)}/change-template`,
    { method: "POST", body: { template_id: templateId } },
  );
  return result.data;
}

/** `P2-12`. `POST /invitations/:id/preview-link` — the only response carrying the token. */
export interface CreatedPreviewLink {
  readonly id: string;
  readonly token: string;
  readonly url: string;
  readonly expires_at: string;
  readonly created_at: string;
}

/** `GET /invitations/:id/preview-links` — never a token, only when and whether it was used. */
export interface PreviewLink {
  readonly id: string;
  readonly expires_at: string;
  readonly created_at: string;
  readonly last_accessed_at: string | null;
}

export async function createPreviewLink(
  api: ApiClient,
  invitationId: string,
): Promise<CreatedPreviewLink> {
  const result = await api.request<CreatedPreviewLink>(
    `/invitations/${encodeURIComponent(invitationId)}/preview-link`,
    { method: "POST" },
  );
  return result.data;
}

export async function listPreviewLinks(
  api: ApiClient,
  invitationId: string,
): Promise<readonly PreviewLink[]> {
  const result = await api.request<PreviewLink[]>(
    `/invitations/${encodeURIComponent(invitationId)}/preview-links`,
  );
  return result.data;
}

export async function revokePreviewLink(
  api: ApiClient,
  invitationId: string,
  linkId: string,
): Promise<void> {
  await api.request(
    `/invitations/${encodeURIComponent(invitationId)}/preview-links/${encodeURIComponent(linkId)}`,
    { method: "DELETE" },
  );
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

// ─── P3-14: Order, payment initiation, payment status ───────────────────────

/**
 * P3-14. Input for `POST /invitations/:id/orders`. `docs/API/07` § Order creation.
 *
 * `amount_total` is NEVER in the request — the server calculates it from `package_id`.
 * Sending it would open a price-manipulation path (`docs/SECURITY/07` § Pricing).
 */
export interface CreateOrderInput {
  readonly packageId: string;
  readonly addonIds: readonly string[];
}

/** The created order row returned by `POST /invitations/:id/orders`. */
export interface CreatedOrder {
  readonly id: string;
  readonly invitation_id: string;
  readonly package_id: string;
  readonly addons: readonly string[];
  readonly amount_total: number;
  readonly order_type: string;
  readonly status: string;
  readonly expired_at: string;
}

export async function createOrder(
  api: ApiClient,
  invitationId: string,
  input: CreateOrderInput,
): Promise<CreatedOrder> {
  const result = await api.request<CreatedOrder>(
    `/invitations/${encodeURIComponent(invitationId)}/orders`,
    {
      method: "POST",
      body: {
        package_id: input.packageId,
        addon_ids: input.addonIds,
      },
    },
  );
  return result.data;
}

/** `GET /orders/:id` — order detail for the payment page summary. */
export interface OrderDetail {
  readonly id: string;
  readonly invitation_id: string;
  readonly package_id: string;
  readonly amount_total: number;
  readonly status: string;
  readonly expired_at: string;
  readonly created_at: string;
}

export async function getOrder(
  api: ApiClient,
  orderId: string,
): Promise<OrderDetail> {
  const result = await api.request<OrderDetail>(
    `/orders/${encodeURIComponent(orderId)}`,
  );
  return result.data;
}

/** The response from `POST /orders/:id/payment` — the provider redirect URL and token. */
export interface PaymentInitiation {
  readonly redirect_url: string;
  readonly token: string;
  readonly expires_at: string;
}

export async function initiatePayment(
  api: ApiClient,
  orderId: string,
): Promise<PaymentInitiation> {
  const result = await api.request<PaymentInitiation>(
    `/orders/${encodeURIComponent(orderId)}/payment`,
    { method: "POST" },
  );
  return result.data;
}

/**
 * `GET /orders/:id/payment/status` — the ONLY source of truth for payment status.
 *
 * `docs/SECURITY/07` Golden Rule: payment status MUST NOT come from URL parameters.
 * A redirect URL with `?status=success` is purely for display purposes (e.g., to show
 * "Memeriksa pembayaran..." immediately) and NEVER used to determine actual status.
 */
export interface PaymentStatus {
  readonly order_status: string;
  readonly payment_status: string | null;
  readonly paid_at: string | null;
}

export async function getPaymentStatus(
  api: ApiClient,
  orderId: string,
  signal?: AbortSignal,
): Promise<PaymentStatus> {
  const result = await api.request<PaymentStatus>(
    `/orders/${encodeURIComponent(orderId)}/payment/status`,
    { ...(signal !== undefined ? { signal } : {}) },
  );
  return result.data;
}

// ─── P3-15: Publish, unpublish, slug change ──────────────────────────────────

/**
 * P3-15. `GET /invitations/:id/publish-check` — completeness check before the confirmation.
 *
 * The client runs the same check locally (`PublishCta.tsx`), but the server is authoritative.
 * This call exists so the modal can show the server's view of what is missing, not the
 * client's, which rules out a discrepancy caused by stale editor state.
 */
export interface PublishCheckResult {
  readonly ready: boolean;
  readonly missing_fields?: readonly {
    readonly section_key: string;
    readonly path: string;
    readonly label: string;
  }[];
}

export async function checkPublish(
  api: ApiClient,
  invitationId: string,
): Promise<PublishCheckResult> {
  const result = await api.request<PublishCheckResult>(
    `/invitations/${encodeURIComponent(invitationId)}/publish-check`,
  );
  return result.data;
}

/** What `POST /invitations/:id/publish` returns on success. */
export interface PublishedInvitation {
  readonly status: string;
  readonly slug: string;
  readonly published_at: string;
  readonly expiry_date: string;
  readonly public_url: string;
}

export async function publishInvitation(
  api: ApiClient,
  invitationId: string,
): Promise<PublishedInvitation> {
  const result = await api.request<PublishedInvitation>(
    `/invitations/${encodeURIComponent(invitationId)}/publish`,
    { method: "POST" },
  );
  return result.data;
}

export async function unpublishInvitation(
  api: ApiClient,
  invitationId: string,
): Promise<{ status: string }> {
  const result = await api.request<{ status: string }>(
    `/invitations/${encodeURIComponent(invitationId)}/unpublish`,
    { method: "POST" },
  );
  return result.data;
}

/**
 * Update the invitation's slug via `PATCH /invitations/:id/settings`.
 *
 * Used both in slug-conflict recovery (P3-15 step 9) and slug-change-after-publish
 * (P3-15 step 13). A slug change on a published invitation returns `slug_change` in the
 * response (ADR-081); the caller is responsible for surfacing the broken-link warning.
 */
export async function updateSlug(
  api: ApiClient,
  invitationId: string,
  slug: string,
): Promise<{ slug: string; slug_change?: { previous_slug: string; links_broken: boolean } }> {
  const result = await api.request<{
    slug: string;
    slug_change?: { previous_slug: string; links_broken: boolean };
  }>(
    `/invitations/${encodeURIComponent(invitationId)}/settings`,
    {
      method: "PATCH",
      body: { slug },
    },
  );
  return result.data;
}

/**
 * P4-10 — Invitation analytics summary. `docs/PLAN/14` § MVP.
 */
export interface InvitationAnalytics {
  readonly views: {
    readonly total: number;
    readonly daily: ReadonlyArray<{ readonly date: string; readonly count: number }>;
  };
  readonly rsvps: {
    readonly total_responses: number;
    readonly attending: number;
    readonly not_attending: number;
    readonly maybe: number;
    readonly total_attending_guests: number;
  };
  readonly guestbook: {
    readonly total: number;
    readonly pending: number;
    readonly approved: number;
    readonly rejected: number;
  };
}

export async function getInvitationAnalytics(
  api: ApiClient,
  invitationId: string,
): Promise<InvitationAnalytics> {
  const result = await api.request<InvitationAnalytics>(
    `/invitations/${encodeURIComponent(invitationId)}/analytics`,
  );
  return result.data;
}

// ─── P4-11: RSVP Management ──────────────────────────────────────────────────

export type RsvpAttendanceStatus = "attending" | "not_attending" | "maybe";

export interface RsvpItem {
  readonly id: string;
  readonly guest_name: string;
  readonly attendance_status: RsvpAttendanceStatus;
  readonly guest_count: number;
  readonly message: string | null;
  readonly created_at: string;
}

export interface RsvpSummary {
  readonly total: number;
  readonly attending: number;
  readonly not_attending: number;
  readonly tentative: number;
  readonly awaiting: number;
  readonly total_attending_guests: number;
}

export async function listInvitationRsvps(
  api: ApiClient,
  invitationId: string,
  options: {
    page?: number | undefined;
    limit?: number | undefined;
    status?: RsvpAttendanceStatus | undefined;
  } = {},
): Promise<{ items: readonly RsvpItem[]; meta?: { page: number; per_page: number; total: number } | undefined }> {
  const query: Record<string, string | number | undefined> = {};
  if (options.page !== undefined) query["page"] = options.page;
  if (options.limit !== undefined) query["limit"] = options.limit;
  if (options.status !== undefined) query["status"] = options.status;

  const result = await api.request<readonly RsvpItem[]>(
    `/invitations/${encodeURIComponent(invitationId)}/rsvps`,
    { query },
  );
  return { items: result.data, meta: result.meta };
}

export async function getInvitationRsvpSummary(
  api: ApiClient,
  invitationId: string,
): Promise<RsvpSummary> {
  const result = await api.request<RsvpSummary>(
    `/invitations/${encodeURIComponent(invitationId)}/rsvps/summary`,
  );
  return result.data;
}

export async function deleteInvitationRsvp(
  api: ApiClient,
  invitationId: string,
  rsvpId: string,
): Promise<void> {
  await api.request(
    `/invitations/${encodeURIComponent(invitationId)}/rsvps/${encodeURIComponent(rsvpId)}`,
    { method: "DELETE" },
  );
}

// ─── P4-11: Guestbook Moderation ──────────────────────────────────────────────

export type GuestbookStatus = "pending" | "approved" | "rejected";

export interface GuestbookItem {
  readonly id: string;
  readonly guest_name: string;
  readonly message: string;
  readonly status: GuestbookStatus;
  readonly created_at: string;
}

export interface GuestbookSummary {
  readonly total: number;
  readonly pending: number;
  readonly approved: number;
  readonly rejected: number;
}

export async function listInvitationGuestbook(
  api: ApiClient,
  invitationId: string,
  options: {
    page?: number | undefined;
    limit?: number | undefined;
    status?: GuestbookStatus | undefined;
  } = {},
): Promise<{ items: readonly GuestbookItem[]; meta?: { page: number; per_page: number; total: number } | undefined }> {
  const query: Record<string, string | number | undefined> = {};
  if (options.page !== undefined) query["page"] = options.page;
  if (options.limit !== undefined) query["limit"] = options.limit;
  if (options.status !== undefined) query["status"] = options.status;

  const result = await api.request<readonly GuestbookItem[]>(
    `/invitations/${encodeURIComponent(invitationId)}/guestbook`,
    { query },
  );
  return { items: result.data, meta: result.meta };
}

export async function getInvitationGuestbookSummary(
  api: ApiClient,
  invitationId: string,
): Promise<GuestbookSummary> {
  const result = await api.request<GuestbookSummary>(
    `/invitations/${encodeURIComponent(invitationId)}/guestbook/summary`,
  );
  return result.data;
}

export async function moderateGuestbookEntry(
  api: ApiClient,
  invitationId: string,
  entryId: string,
  status: "approved" | "rejected",
): Promise<GuestbookItem> {
  const result = await api.request<GuestbookItem>(
    `/invitations/${encodeURIComponent(invitationId)}/guestbook/${encodeURIComponent(entryId)}`,
    { method: "PATCH", body: { status } },
  );
  return result.data;
}

export async function deleteGuestbookEntry(
  api: ApiClient,
  invitationId: string,
  entryId: string,
): Promise<void> {
  await api.request(
    `/invitations/${encodeURIComponent(invitationId)}/guestbook/${encodeURIComponent(entryId)}`,
    { method: "DELETE" },
  );
}

// ─── Slug helpers ─────────────────────────────────────────────────────────────

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
