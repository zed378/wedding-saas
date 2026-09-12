import type { FieldMeta } from "./registry";

/**
 * P1-23 step 5 — client validation. `docs/FRONTEND/03` § Validation.
 *
 * ## It mirrors the server and never replaces it
 *
 * `docs/FRONTEND/03`: client-side validation is "fast UX, non-authoritative". Every rule here
 * exists in `backend/api/src/modules/invitation/` as well, and the server's answer wins. What
 * this buys is that a user learns a date is malformed while typing it rather than a second
 * later from a red banner.
 *
 * ## What it deliberately does not do
 *
 * **It does not sanitize.** `docs/SECURITY/08` puts stored-XSS prevention on the server, and
 * `P1-16` built it there. A frontend that stripped tags before sending would make the server's
 * sanitiser look unnecessary to whoever reads the code next — and the API accepts requests
 * that never came from this form.
 *
 * **It does not check uniqueness or existence.** Nothing here can know whether a slug is
 * taken or a media id is this invitation's. Those are questions only the server can answer,
 * and asking them here would mean answering them wrongly.
 */

/** `HH:MM`, the shape `docs/DATABASE/05`'s `time` columns accept. */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `YYYY-MM-DD`. A `date` column, not a timestamp — no timezone, no time. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An Instagram handle: letters, digits, dots and underscores, up to 30.
 *
 * Without the `@`, which is why the helper text says so. Storing it with one would put a
 * double `@` in every profile link the renderer builds.
 */
const INSTAGRAM = /^[A-Za-z0-9._]{1,30}$/;

export function validateField(
  meta: FieldMeta,
  path: string,
  raw: unknown,
): string | undefined {
  // Empty is not invalid. Whether a field may be empty is a *completeness* question, decided
  // by the template's `required_fields` and enforced at publish time (BR-4.2) — not something
  // to shout about while somebody is still filling the form in.
  if (raw === undefined || raw === null || raw === "") return undefined;

  if (meta.type === "toggle") {
    return typeof raw === "boolean" ? undefined : "Nilai tidak valid.";
  }

  if (meta.type === "select") {
    const allowed = meta.options?.map((o) => o.value) ?? [];
    return allowed.includes(String(raw))
      ? undefined
      : "Pilih salah satu opsi yang tersedia.";
  }

  if (meta.type === "date") {
    if (!DATE.test(String(raw))) return "Gunakan format tanggal YYYY-MM-DD.";
    return Number.isNaN(Date.parse(`${String(raw)}T00:00:00Z`))
      ? "Tanggal tidak valid."
      : undefined;
  }

  if (meta.type === "time") {
    return TIME.test(String(raw)) ? undefined : "Gunakan format waktu HH:MM.";
  }

  if (meta.type === "map-picker") {
    const value = Number(raw);
    if (Number.isNaN(value)) return "Koordinat tidak valid.";

    // The ranges the API coerces and checks (`P1-12`). Latitude and longitude share a
    // control, so which bound applies comes from the path rather than the type.
    const limit = path.endsWith("latitude") ? 90 : 180;
    return Math.abs(value) > limit
      ? `Koordinat di luar jangkauan (maksimal ${String(limit)}).`
      : undefined;
  }

  if (meta.type === "photo" || meta.type === "photo-multi") {
    // A media id, nothing more. Whether it is *this invitation's* and whether it is `ready`
    // are `P1-19`'s checks, and they are 404s rather than validation errors on purpose.
    return typeof raw === "string" && raw.length > 0
      ? undefined
      : "Foto belum dipilih.";
  }

  const text = String(raw);

  if (meta.maxLength !== undefined && text.length > meta.maxLength) {
    return `Maksimal ${String(meta.maxLength)} karakter.`;
  }

  if (path.endsWith(".instagram") && !INSTAGRAM.test(text)) {
    return "Gunakan nama pengguna Instagram tanpa tanda @.";
  }

  if (path.endsWith(".maps_url") && !/^https?:\/\//i.test(text)) {
    // `P1-12` found that `z.string().url()` accepts `javascript:alert(1)` — measured, not
    // assumed — and added this same prefix check server-side. Mirrored here so the user is
    // told while typing rather than on save.
    return "Tautan harus dimulai dengan http:// atau https://.";
  }

  return undefined;
}
