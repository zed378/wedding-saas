import { INVITATION_FIELD_PATHS } from "@wi/schema";

/**
 * P1-23 step 1 — the canonical field registry. `docs/FRONTEND/03` § Canonical Field Metadata.
 *
 * ## Two registries, one vocabulary
 *
 * `@wi/schema`'s `INVITATION_FIELDS` is the **path** vocabulary: what a template may
 * reference, and whether each path is a scalar or a collection. It is shared with the
 * backend, which uses it for publish-completeness validation. This file adds the **form**
 * metadata the backend has no use for: which control renders a path, what it is called in
 * Indonesian, how long it may be.
 *
 * The two must not drift, and a comment saying so is worth nothing. `registry.spec.ts`
 * asserts both directions: every scalar path in `@wi/schema` has an entry here, and every key
 * here is a path `@wi/schema` recognises. Adding a field to `docs/PLAN/08` without a label
 * fails the frontend build, which is the point.
 *
 * ## Collection paths are not fields
 *
 * `events`, `gallery.photos` and `gift.accounts` are containers — a template referencing
 * `events` means "this section shows the events", not "render one control". They are listed
 * in `COLLECTION_PATHS` with a reason, so the drift test can exempt them by name rather than
 * by a rule somebody could widen.
 */

export type FieldType =
  | "text"
  | "textarea"
  | "date"
  | "time"
  | "photo"
  | "photo-multi"
  | "select"
  | "map-picker"
  | "toggle";

export interface FieldMeta {
  readonly type: FieldType;
  /** Indonesian, because the editor is. */
  readonly label: string;
  /** The column width from `docs/DATABASE/05`, mirrored so a user learns it while typing. */
  readonly maxLength?: number;
  readonly helperText?: string;
  /** For `select`. The value is what is stored; the label is what is shown. */
  readonly options?: readonly {
    readonly value: string;
    readonly label: string;
  }[];
}

/**
 * Paths that name a collection rather than a control.
 *
 * Named individually, with the reason, rather than inferred from a shape — an inferred rule
 * ("anything without a `*` after it") would silently exempt a real field the day somebody
 * added one at the top level.
 */
export const COLLECTION_PATHS: Readonly<Record<string, string>> = {
  events:
    "a 1..N collection; the panel renders a list editor, not one control (docs/PLAN/08 § Entity: Event)",
  "gallery.photos":
    "a collection rendered by the photo-multi control bound to `gallery.photos.*` (P1-24)",
  "gift.accounts":
    "a 1..N collection of gift destinations; the list editor is P1-24's",
};

const PERSON_FIELDS = (role: "groom" | "bride", who: string) => ({
  [`couple.${role}.full_name`]: {
    type: "text" as const,
    label: `Nama lengkap ${who}`,
    maxLength: 150,
  },
  [`couple.${role}.nickname`]: {
    type: "text" as const,
    label: `Nama panggilan ${who}`,
    maxLength: 60,
  },
  [`couple.${role}.photo`]: {
    type: "photo" as const,
    label: `Foto ${who}`,
  },
  [`couple.${role}.instagram`]: {
    type: "text" as const,
    label: `Instagram ${who}`,
    maxLength: 60,
    helperText: "Tanpa tanda @.",
  },
  [`couple.${role}.father_name`]: {
    type: "text" as const,
    label: `Nama ayah ${who}`,
    maxLength: 150,
  },
  [`couple.${role}.mother_name`]: {
    type: "text" as const,
    label: `Nama ibu ${who}`,
    maxLength: 150,
  },
  [`couple.${role}.child_order`]: {
    type: "text" as const,
    label: `Anak ke- ${who}`,
    maxLength: 60,
    helperText: "Contoh: putra pertama.",
  },
});

const EVENT_FIELDS = {
  "events.*.type": {
    type: "select" as const,
    label: "Jenis acara",
    // The three the CHECK constraint permits (`docs/DATABASE/05`). A fourth here would be
    // accepted by the form and rejected by the database.
    options: [
      { value: "akad", label: "Akad" },
      { value: "reception", label: "Resepsi" },
      { value: "custom", label: "Acara lain" },
    ],
  },
  "events.*.title": {
    type: "text" as const,
    label: "Judul acara",
    maxLength: 150,
  },
  "events.*.date": { type: "date" as const, label: "Tanggal" },
  "events.*.start_time": { type: "time" as const, label: "Waktu mulai" },
  "events.*.end_time": { type: "time" as const, label: "Waktu selesai" },
  "events.*.venue_name": {
    type: "text" as const,
    label: "Nama tempat",
    maxLength: 200,
  },
  "events.*.address": { type: "textarea" as const, label: "Alamat" },
  // Latitude and longitude are one control. Both paths point at it, and the picker writes
  // both — a pair of number inputs would ask a couple to type coordinates.
  "events.*.latitude": { type: "map-picker" as const, label: "Lokasi di peta" },
  "events.*.longitude": {
    type: "map-picker" as const,
    label: "Lokasi di peta",
  },
  "events.*.maps_url": {
    type: "text" as const,
    label: "Tautan peta",
    maxLength: 500,
    helperText: "Dibuat otomatis dari lokasi jika dikosongkan.",
  },
  "events.*.description": {
    type: "textarea" as const,
    label: "Catatan acara",
  },
};

const GALLERY_FIELDS = {
  "gallery.photos.*.media_id": {
    type: "photo-multi" as const,
    label: "Galeri foto",
  },
  "gallery.photos.*.caption": {
    type: "text" as const,
    label: "Keterangan foto",
    maxLength: 200,
  },
  "gallery.photos.*.order": {
    type: "text" as const,
    label: "Urutan foto",
    helperText: "Diatur dengan menggeser foto.",
  },
  "gallery.photos.*.is_cover": {
    type: "toggle" as const,
    label: "Jadikan foto sampul",
  },
};

const GIFT_FIELDS = {
  "gift.accounts.*.type": {
    type: "select" as const,
    label: "Jenis",
    options: [
      { value: "bank", label: "Rekening bank" },
      { value: "ewallet", label: "Dompet digital" },
    ],
  },
  "gift.accounts.*.provider_name": {
    type: "text" as const,
    label: "Nama bank atau dompet",
    maxLength: 60,
  },
  "gift.accounts.*.account_number": {
    type: "text" as const,
    label: "Nomor rekening",
    maxLength: 60,
  },
  "gift.accounts.*.account_holder": {
    type: "text" as const,
    label: "Atas nama",
    maxLength: 150,
  },
  "gift.accounts.*.order": {
    type: "text" as const,
    label: "Urutan",
    helperText: "Diatur dengan menggeser.",
  },
};

/** Every scalar path in `docs/PLAN/08`, with what renders it. */
export const FIELD_REGISTRY: Readonly<Record<string, FieldMeta>> = {
  ...PERSON_FIELDS("groom", "mempelai pria"),
  ...PERSON_FIELDS("bride", "mempelai wanita"),
  ...EVENT_FIELDS,
  ...GALLERY_FIELDS,
  ...GIFT_FIELDS,
  "quote.text": {
    type: "textarea" as const,
    label: "Kutipan",
    maxLength: 2000,
  },
  "quote.source": {
    type: "text" as const,
    label: "Sumber kutipan",
    maxLength: 200,
  },
};

/**
 * The metadata for a path a template asked for.
 *
 * A template references a concrete path (`events.0.title`), and the registry is keyed by the
 * canonical pattern (`events.*.title`). This normalises the first into the second, which is
 * what lets one registry entry serve every element of a collection.
 *
 * Returns `undefined` for an unknown path rather than throwing: a template version written
 * before a field was removed should render the fields it still recognises, not a blank panel.
 */
export function fieldMeta(path: string): FieldMeta | undefined {
  return FIELD_REGISTRY[canonicalise(path)];
}

/** `events.0.title` → `events.*.title`. Indices and uuids both become `*`. */
export function canonicalise(path: string): string {
  return path
    .split(".")
    .map((segment, index) =>
      index > 0 && isCollectionIndex(segment) ? "*" : segment,
    )
    .join(".");
}

function isCollectionIndex(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  // A uuid, for an event or a gift account addressed by id.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    segment,
  );
}

/** Exported for the drift test, so it reads one vocabulary rather than restating it. */
export const CANONICAL_PATHS = INVITATION_FIELD_PATHS;
