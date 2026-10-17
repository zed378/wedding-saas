# Implementation Plan — P3-14 & P3-15: Checkout, Payment Status, and Publish Flow

**Prepared:** 2026-09-16  
**Tasks:** P3-14 (Frontend: Checkout and Payment Status), P3-15 (Frontend: Publish Flow and Share Screen)  
**Sequential execution:** P3-14 first, then P3-15

---

## Context Summary

Both tasks implement frontend flows whose backend APIs are complete (`P3-02` through `P3-10`). The frontend follows these architectural patterns already established:

- **API client:** `@wi/api-client` with typed request/response, in-memory token storage only
- **Auth context:** `useAuth()` hook provides `api` client and `user`
- **Type-safe API wrappers:** `frontend/web-app/src/lib/*.ts` files define types and call wrappers
- **Schema-driven UI:** components read from `@wi/schema`, never hard-code field paths
- **Design tokens:** all colours, spacing, typography from `@wi/ui/tokens.css`
- **Indonesian language:** all UI text in Bahasa Indonesia
- **No status from URL:** `docs/SECURITY/07` golden rule — never trust redirect parameters

**Key backend endpoints** (already implemented):
- `POST /invitations/:id/orders` → create order, returns `order_id` (P3-02)
- `POST /orders/:order_id/payment` → initiate payment, returns `redirect_url` + `token` (P3-04)
- `GET /orders/:order_id/payment/status` → poll status, server queries provider if needed (P3-06)
- `GET /orders` → order history (P3-08)
- `POST /invitations/:id/publish` → publish invitation, handles paid and trial (P3-09)
- `POST /invitations/:id/unpublish` → unpublish (P3-10)
- `GET /invitations/:id/publish-check` → completeness check, returns missing fields (P2-06)

---

## P3-14 — Frontend: Checkout and Payment Status

### Overview
Implement the checkout flow from order creation through payment initiation and status polling, with **ZERO trust in URL parameters**. Every status is server-decided.

---

### 1. Create `/checkout/[invitationId]/page.tsx` — The Checkout Page

**What:** Single-package checkout page showing Rp 139,000 for 12 months, with payment initiation.

**Files to create:**
- `frontend/web-app/src/app/(app)/checkout/[invitationId]/page.tsx`

**Files to modify:**
- `frontend/web-app/src/lib/invitations.ts` (add order creation wrapper)

**Implementation:**
- Route group `(app)` makes it authenticated automatically via existing `RequireAuth`
- Fetch invitation detail (`GET /invitations/:id`) to show invitation name
- Display single package card: "Paket Standard", "Rp 139.000", "12 bulan", list features from `docs/PLAN/09` (200 photos, no watermark, RSVP, guestbook, gallery, maps, gift)
- "Bayar Sekarang" button → calls `POST /invitations/:id/orders` with `{ package_id: "standard", addon_ids: [] }`
- On 409 `ACTIVE_ORDER_EXISTS`, extract `order_id` from `error.details[0].message` and redirect to payment
- On 201, redirect to `/checkout/[invitationId]/payment/[orderId]`
- Handle 422 `ORDER_NOT_ALLOWED` → "Undangan sudah dibayar, silakan terbitkan"
- Handle 403 `EMAIL_NOT_VERIFIED` → "Verifikasi email Anda terlebih dahulu"
- Loading state on button, disable while creating order

**API wrapper in `lib/invitations.ts`:**
```typescript
export interface CreateOrderInput {
  readonly packageId: string;
  readonly addonIds: readonly string[];
}

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
```

**Verify:** Navigate to `/checkout/[id]`, see package card, click "Bayar Sekarang" → redirects to payment page. Check Network tab shows `POST /invitations/:id/orders` with correct body, no `amount_total` in request.

---

### 2. Create `/checkout/[invitationId]/payment/[orderId]/page.tsx` — Payment Initiation and Awaiting

**What:** Show payment summary, initiate payment with provider, then poll for status. **NEVER reads `?status=` from URL.**

**Files to create:**
- `frontend/web-app/src/app/(app)/checkout/[invitationId]/payment/[orderId]/page.tsx`

**Files to modify:**
- `frontend/web-app/src/lib/invitations.ts` (add payment initiation and status wrappers)

**Implementation:**

**Phase 1: Before initiation**
- Fetch order detail (`GET /orders/:orderId`) to show: invitation name, package, amount (Rp 139.000), expired_at
- "Lanjutkan ke Pembayaran" button → calls `POST /orders/:orderId/payment`
- On 201 response with `redirect_url`, open in new window: `window.open(redirect_url, '_blank')`
- **Detect in-app browser** (WhatsApp, Instagram WebView): check `navigator.userAgent` for "FBAN", "FBAV", "Instagram", "Line" → show banner "Buka di browser eksternal untuk melanjutkan pembayaran" with copy-link button
- Show official Midtrans logo for trust (card step 8)

**Phase 2: After opening payment**
- Automatically start polling `GET /orders/:orderId/payment/status` every 3 seconds
- URL parameter `?returning=true` is **informational only** — used to show "Memeriksa status pembayaran…" immediately instead of "Klik di sini setelah membayar"
- **NEVER** read `?status=success` or any status from URL — card DoD explicitly tests this

**Status display logic:**
- `payment_status === null` → "Menunggu pembayaran…" (neutral)
- `payment_status === 'pending'` → "Memeriksa pembayaran…" with spinner, keep polling
- `payment_status === 'success'` → "Pembayaran berhasil!" (green), stop polling, show "Lanjutkan ke Terbitkan" button → `/editor/{invitationId}`
- `payment_status === 'failed'` → "Pembayaran gagal" (red), stop polling, show "Coba Lagi" → back to `/checkout/{invitationId}`
- `order_status === 'expired'` → "Pesanan kedaluwarsa", show "Buat pesanan baru"

**Polling timeout (card step 6):**
- After 60 seconds (20 polls × 3s), stop polling and show: "Pembayaran masih diproses. Kami akan mengirim email jika berhasil."
- Keep showing current status, don't claim success

**API wrappers in `lib/invitations.ts`:**
```typescript
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
```

**Verify:** 
- Navigate to payment page, see order summary and "Lanjutkan" button
- Click → new tab opens (mock URL in dev), page shows "Memeriksa status pembayaran…"
- Add `?returning=true` manually → still polling, no success claimed
- Tamper URL with `?status=success` → MUST NOT show success state (DoD check)
- Mock API to return `payment_status: 'success'` → green banner appears, polling stops

---

### 3. Create `PaymentStatusBanner` component

**What:** Reusable status display with spinner, mentioned in `docs/UI-UX/10`.

**Files to create:**
- `frontend/web-app/src/components/PaymentStatusBanner.tsx`

**Implementation:**
- Props: `status: 'pending' | 'success' | 'failed' | 'expired' | 'checking'`, `onRetry?: () => void`
- `checking` → yellow banner, spinner from `@wi/ui`, "Memeriksa pembayaran…"
- `pending` → neutral, "Menunggu pembayaran"
- `success` → green background, checkmark, "Pembayaran berhasil!"
- `failed` → red, "Pembayaran gagal", show "Coba Lagi" button if `onRetry` provided
- `expired` → red, "Pesanan kedaluwarsa"
- All colours from design tokens (`@wi/ui/tokens.css`)

**Verify:** Render in isolation with each status prop, check colors match design system, spinner animates for `checking`.

---

### 4. Add checkout link to `InvitationCard.tsx`

**What:** "Bayar" button for `pending_payment` invitations.

**Files to modify:**
- `frontend/web-app/src/components/InvitationCard.tsx`

**Implementation:**
- When `invitation.status === 'pending_payment'`, show "Bayar" button alongside "Edit"
- Links to `/checkout/${invitation.id}`
- Button style: primary accent color from tokens

**Verify:** Create invitation → checkout → abandon before paying → return to dashboard → see "Bayar" button on card.

---

### 5. Create in-app browser detection utility

**What:** Detect WhatsApp/Instagram WebView, mentioned in card step 7.

**Files to create:**
- `frontend/web-app/src/lib/in-app-browser.ts`

**Implementation:**
```typescript
export function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || navigator.vendor || "";
  return /FBAN|FBAV|Instagram|Line|Line\//.test(ua);
}

export function getBrowserName(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const ua = navigator.userAgent || "";
  if (/Instagram/.test(ua)) return "Instagram";
  if (/FBAN|FBAV/.test(ua)) return "Facebook";
  if (/Line/.test(ua)) return "LINE";
  return undefined;
}
```

**Verify:** Test in real WhatsApp/Instagram in-app browser if available, or mock `navigator.userAgent` in tests.

---

### 6. Update FRONTEND/01-ROUTING.md docs

**What:** Document new checkout routes.

**Files to modify:**
- `docs/FRONTEND/01-ROUTING.md`

**Implementation:**
- Add routes:
  - `/checkout/[invitationId]` → (protected) package selection and order creation
  - `/checkout/[invitationId]/payment/[orderId]` → (protected) payment initiation and status

**Verify:** Read the doc, routes are listed under Web App section.

---

## P3-15 — Frontend: Publish Flow and Share Screen

### Overview
Wire "Publish" button to server check, handle missing fields, show publish confirmation, display shareable link, surface slug conflicts, show unpublish/republish actions.

---

### 7. Wire `PublishCta.tsx` to actually publish

**What:** Make the existing "Terbitkan" button call the publish endpoint.

**Files to modify:**
- `frontend/web-app/src/editor/PublishCta.tsx`
- `frontend/web-app/src/lib/invitations.ts` (add publish-check and publish wrappers)

**Implementation:**

**Step 1: Publish-check on click**
- When "Terbitkan" clicked (when enabled), call `GET /invitations/:id/publish-check`
- Response `{ ready: true }` → proceed to confirmation modal
- Response `{ ready: false, missing_fields: [...] }` → show modal listing missing fields

**Missing-field modal:**
- Title: "Lengkapi isian berikut sebelum menerbitkan"
- List each field from `missing_fields[]` with its `section_key` and `path`
- Use `describeMissingField()` from `@wi/schema` (already used in the button's list)
- Each field is a **link** that jumps to section + scrolls properties panel: `onClick` → `setActiveSection(field.section_key)` + focus the input
- "Tutup" button to dismiss

**Step 2: Slug confirmation (docs/PLAN/04 § F8)**
- Modal: "Konfirmasi alamat undangan"
- Show full URL: `invitation.vizunicum.my.id/{slug}`
- "Alamat ini tidak dapat diubah setelah diterbitkan" (actually can, but with broken links warning — card step 6)
- "Batalkan" and "Terbitkan" buttons

**Step 3: Call publish**
- `POST /invitations/:id/publish`, no body
- On 200 → close modal, show success + live link modal
- On 409 `SLUG_TAKEN` → inline error "Alamat sudah digunakan, coba yang lain" with suggestion from `error.details[0].suggestion` if provided
- On 422 `INCOMPLETE_INVITATION` → should not happen (publish-check passed), but show the details anyway
- On 422 `TRIAL_ALREADY_USED` / `RENEWAL_REQUIRED` / `PAYMENT_PENDING` → show message, offer "Bayar" button to `/checkout/{invitationId}`

**API wrappers in `lib/invitations.ts`:**
```typescript
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
```

**Verify:** 
- Incomplete invitation → click Terbitkan → modal lists missing fields, each is clickable → sets active section
- Complete but unpaid invitation → publish → shows payment required modal
- Complete paid invitation → publish → shows slug confirmation → click Terbitkan → success modal with link
- After publish, try publishing again → 422 `INVITATION_ALREADY_PUBLISHED` gracefully handled

---

### 8. Create Publish Success Modal with Share Actions

**What:** Show public URL, WhatsApp share button, copy-link button (card step 4).

**Files to create:**
- `frontend/web-app/src/components/PublishSuccessModal.tsx`

**Implementation:**
- Props: `publicUrl: string`, `onClose: () => void`
- Display: "Undangan berhasil diterbitkan!" (green)
- Show clickable link: `{publicUrl}` → opens in new tab
- **WhatsApp share button:** 
  - Text: "Bagikan via WhatsApp"
  - Link: `https://wa.me/?text=${encodeURIComponent("Undangan pernikahan kami: " + publicUrl)}`
  - Opens in new tab
- **Copy link button:**
  - Calls `navigator.clipboard.writeText(publicUrl)`
  - Changes text to "Tersalin!" for 2 seconds
  - Fallback if clipboard API unavailable: select the URL text
- "Tutup" button

**Verify:** 
- Publish invitation → modal shows with working link
- Click "Salin tautan" → URL copied to clipboard
- Click "Bagikan via WhatsApp" → opens WhatsApp with pre-filled message (or WhatsApp Web if on desktop)

---

### 9. Create Slug Conflict Recovery Flow

**What:** When publish returns 409 `SLUG_TAKEN`, let user edit slug inline (card DoD step 3).

**Files to modify:**
- `frontend/web-app/src/editor/PublishCta.tsx` (handle 409 inline)

**Implementation:**
- On 409 from `POST /publish`, show inline form WITHIN the confirmation modal:
  - "Alamat '{{slug}}' sudah digunakan"
  - Show `error.details[0].suggestion` if available: "Coba: {{suggestion}}"
  - Editable text input with current slug
  - "Gunakan Alamat Ini" button → calls `PATCH /invitations/:id/settings` with `{ slug: newSlug }`
  - On success → retry publish with new slug
  - On 409 again → repeat (user keeps trying until they find available slug)
- Don't navigate away from modal — keep user in publish flow

**API wrapper in `lib/invitations.ts`:**
```typescript
export async function updateSlug(
  api: ApiClient,
  invitationId: string,
  slug: string,
): Promise<void> {
  await api.request(
    `/invitations/${encodeURIComponent(invitationId)}/settings`,
    {
      method: "PATCH",
      body: { slug },
    },
  );
}
```

**Verify:** 
- Manually create invitation with slug "test"
- Create second invitation with same slug "test"
- Try to publish second → 409 → inline form appears → change to "test-2" → publish succeeds

---

### 10. Add Unpublish Action to Editor Settings

**What:** Unpublish button in editor header or settings section (card step 6).

**Files to modify:**
- `frontend/web-app/src/editor/EditorShell.tsx` (add settings dropdown or button)
- OR create `frontend/web-app/src/editor/InvitationSettings.tsx` if dedicated section

**Implementation:**
- When `invitation.status === 'published'`, show "Unpublish" action
- **Confirmation modal before unpublish:**
  - "Batalkan publikasi undangan?"
  - "Tautan publik akan berhenti bekerja. Tamu yang sudah punya link tidak akan bisa mengaksesnya."
  - "Batalkan Publikasi" (danger button) and "Batal"
- On confirm → `POST /invitations/:id/unpublish`
- On success → invitation status becomes `paid` or `draft`, remove publish button, show success message

**API wrapper in `lib/invitations.ts`:**
```typescript
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
```

**Verify:** 
- Publish invitation → unpublish button appears
- Click → confirmation modal → confirm → invitation becomes `paid`
- Public link returns 404

---

### 11. Add Republish Flow to Editor

**What:** Published invitations can be unpublished then republished, per ADR-081.

**Files to modify:**
- `frontend/web-app/src/editor/PublishCta.tsx` (detect `paid` status and allow republish)

**Implementation:**
- When `invitation.status === 'paid'` AND invitation was previously published (check `published_at` field), show "Terbitkan Kembali" button
- Same flow as publish but skip completeness check (already published once means complete)
- **Important:** Republish keeps original `expiry_date` per ADR-081 — don't claim it adds time
- On success → status becomes `published` again, same slug, same expiry

**Verify:** 
- Publish → unpublish → republish → status becomes published again
- Check expiry_date unchanged

---

### 12. Show Upgrade Prompt for Expired Never-Paid Invitations (Dashboard)

**What:** Trial invitations that expired before reaching `paid` should show "upgrade" not "renewal" (P3-09, ADR-052, card step 7).

**Files to modify:**
- `frontend/web-app/src/components/InvitationCard.tsx`

**Implementation:**
- When `invitation.status === 'expired'` AND check order history: if NO paid order ever existed → show "Upgrade ke Premium" button instead of "Renew"
- Link to `/checkout/{invitationId}`
- **Note:** This requires fetching order history for each expired invitation OR adding a flag to the invitation list response (e.g., `ever_paid: boolean`)
- **Simpler approach (if backend doesn't provide flag):** Just show "Bayar" for all expired — correct for trials and reasonable for actual renewals

**Verify:** 
- Publish as trial → wait for expiry (or set `expiry_date` in DB to past) → dashboard shows "Upgrade" or "Bayar" button

---

### 13. Handle Slug Change After Publish

**What:** Show warning when slug changes for published invitation (card step 6, ADR-081).

**Files to modify:**
- `frontend/web-app/src/editor/EditorScreen.tsx` or create dedicated settings component

**Implementation:**
- Settings panel or modal with slug edit field
- When invitation is `published`, show warning: "Mengubah alamat akan membuat tautan lama tidak berfungsi"
- On slug change → `PATCH /invitations/:id/settings` with `{ slug: newSlug }`
- Response includes `slug_change: { previous_slug, links_broken: true }` per ADR-081
- Show confirmation: "Alamat diubah. Tautan lama ({{previous_slug}}) tidak lagi berfungsi."

**API interaction:** Already covered in step 9's `updateSlug` wrapper.

**Verify:** 
- Publish invitation with slug "old"
- Change slug to "new" → warning appears → confirm → slug changed
- Old URL returns 404, new URL works

---

### 14. Update InvitationCard to Show Publish Status

**What:** After publishing, dashboard card should indicate "Terbit" status with link.

**Files to modify:**
- `frontend/web-app/src/components/InvitationCard.tsx` (already has this)

**Implementation:**
- Already implemented: when `status === 'published'` and `slug !== null`, shows public URL
- Verify it shows correctly after first publish

**Verify:** 
- Publish invitation → return to dashboard → card shows status badge "Terbit" and public URL

---

### 15. Add Trial Notice Badge (if in trial)

**What:** Show trial badge on dashboard for trial-published invitations.

**Files to modify:**
- `frontend/web-app/src/components/InvitationCard.tsx`

**Implementation:**
- If invitation has `display.watermark === true` (from P3-09, trial indicator), show small "Trial" badge
- Badge: neutral color, small text, e.g., "Uji coba - 3 hari"
- Place near status badge

**Note:** This requires invitation summary to include trial indicator. If not available, skip this step or add minimal API change.

**Verify:** Publish as trial → dashboard shows trial indicator.

---

## Testing Strategy

### Unit Tests

1. **`lib/invitations.ts`** — API wrappers:
   - `createOrder` sends correct body with `package_id` and `addon_ids`
   - `initiatePayment` calls correct endpoint
   - `getPaymentStatus` returns typed response
   - `publishInvitation` handles 200 and 409 responses
   - `unpublishInvitation` calls correct endpoint

2. **`PaymentStatusBanner.tsx`:**
   - Renders correctly for each status: `pending`, `success`, `failed`, `expired`, `checking`
   - Shows spinner for `checking`
   - Calls `onRetry` when retry button clicked

3. **`PublishSuccessModal.tsx`:**
   - Renders public URL
   - Copy button calls `navigator.clipboard.writeText`
   - WhatsApp button generates correct link

4. **`in-app-browser.ts`:**
   - `isInAppBrowser()` detects known user agents
   - `getBrowserName()` returns correct names

### Integration Tests

1. **Checkout flow:**
   - Navigate to `/checkout/{id}` → renders package card
   - Click "Bayar" → creates order and redirects
   - Handle 409 active order → extracts order ID and redirects

2. **Payment status polling:**
   - Mocked API returns `payment_status: 'pending'` → shows checking banner, keeps polling
   - Mocked API returns `payment_status: 'success'` → shows success, stops polling
   - URL with `?status=success` → does NOT show success without server confirmation

3. **Publish flow:**
   - Incomplete invitation → click Terbitkan → shows missing field modal
   - Complete paid invitation → click Terbitkan → shows slug confirmation → publishes
   - 409 slug conflict → shows inline form → change slug → retries

4. **Unpublish/republish:**
   - Published invitation → click unpublish → shows confirmation → unpublishes
   - Unpublished invitation → click republish → publishes again

### E2E Tests (if available)

1. Full checkout: create order → initiate payment (mock) → poll status → success → publish
2. Publish with incomplete fields → fix fields → publish succeeds
3. Dashboard shows correct status after publish

---

## Definition of Done Verification

### P3-14 DoD:

- [x] **1. URL tidak mengandung status yang dibaca UI:** Payment page ignores `?status=success` parameter (step 2 explicitly implements this)
- [x] **2. Payment status tidak pernah ambigu:** Status comes only from `GET /orders/:id/payment/status` server response (step 2)
- [x] **3. Polling fallback muncul setelah timeout:** After 60 seconds, shows "masih diproses" message (step 2)
- [x] **4. Checkout bekerja di WhatsApp in-app browser:** Detects in-app browser and offers "buka di browser" (step 5, used in step 2)

### P3-15 DoD:

- [x] **1. Missing-field errors navigable:** Modal lists missing fields, each clickable to jump to section (step 7)
- [x] **2. Publish result screen menampilkan working public link:** Success modal shows public URL (step 8)
- [x] **3. Slug conflict recoverable tanpa keluar dari flow:** 409 handled inline, user edits slug and retries (step 9)
- [x] **4. Unpublish menjelaskan apa yang terjadi sebelum terjadi:** Confirmation modal explains consequence (step 10)

---

## Security Considerations

1. **NEVER trust URL parameters for payment status** — only server response from `GET /orders/:id/payment/status`
2. **NEVER send `amount_total` in order creation** — server calculates from `package_id`
3. **NEVER skip server-side completeness check** — `POST /publish` is authoritative, not client-side validation
4. **All API calls use authenticated client** — `useAuth()` provides token automatically
5. **Slug availability is advisory** — `POST /invitations` and `POST /publish` remain authoritative

---

## Files Summary

### New Files (14):
1. `frontend/web-app/src/app/(app)/checkout/[invitationId]/page.tsx`
2. `frontend/web-app/src/app/(app)/checkout/[invitationId]/payment/[orderId]/page.tsx`
3. `frontend/web-app/src/components/PaymentStatusBanner.tsx`
4. `frontend/web-app/src/components/PublishSuccessModal.tsx`
5. `frontend/web-app/src/lib/in-app-browser.ts`

### Modified Files (8):
6. `frontend/web-app/src/lib/invitations.ts` (add 8 API wrappers: createOrder, initiatePayment, getPaymentStatus, checkPublish, publishInvitation, unpublishInvitation, updateSlug, + types)
7. `frontend/web-app/src/editor/PublishCta.tsx` (wire to actual publish flow)
8. `frontend/web-app/src/components/InvitationCard.tsx` (add "Bayar" button for pending_payment)
9. `frontend/web-app/src/editor/EditorShell.tsx` (add unpublish action)
10. `frontend/web-app/src/editor/EditorScreen.tsx` (handle slug change warnings)
11. `docs/FRONTEND/01-ROUTING.md` (document checkout routes)

### Tests (estimate):
- 6 unit test files for new components and utilities
- 4 integration test files for flows
- 2 E2E test files for critical paths

---

## Build and Verification

After each step:
1. `pnpm --filter @wi/web-app typecheck` — no TypeScript errors
2. `pnpm --filter @wi/web-app test` — all unit tests pass
3. Manual testing in browser — flow completes successfully
4. Check `scripts/check-design-tokens.mjs` — no hardcoded colors/spacing
5. Check `scripts/check-token-storage.mjs` — no localStorage token access

Final verification:
- `pnpm verify` — all checks pass
- `pnpm --filter @wi/web-app build` — builds without errors
- Manual walkthrough: checkout → payment → publish → unpublish → republish
- Test with tampered URL: `?status=success` → does NOT claim success
