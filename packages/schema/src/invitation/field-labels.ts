import {
  SECTION_KEYS,
  type SectionKey,
} from "../template/component-registry.js";
import { INVITATION_FIELD_PATHS } from "./field-registry.js";

/**
 * P2-06 step 3 — a human name for every canonical field path, and for every section.
 *
 * `docs/API/00`'s `ErrorDetail` is `{ field, message }`, so the publish check and the
 * publish 422 both carry human text. The card's DoD puts it plainly: *"field paths never
 * reach the user interface untranslated"* — a checklist that says `couple.bride.nickname`
 * tells a couple nothing about what to go and fill in.
 *
 * ## Why these are not the editor's labels
 *
 * `frontend/web-app/src/editor/fields/registry.ts` has its own labels and keeps them.
 * The two read in different places and must say different things:
 *
 *   - the **editor's** label sits inside a section, under its heading, beside its
 *     control — so "Nama panggilan" is enough, because the heading already says whose.
 *   - **this** label stands alone in a list of everything left to do, often out of order
 *     and away from any heading — so it has to carry the whole answer:
 *     "Nama panggilan mempelai wanita".
 *
 * A single shared string would be wrong in one of the two places, and the wrong one is
 * usually the standalone message, where a missing qualifier turns a checklist into a
 * guessing game. What IS shared is the path vocabulary itself, and
 * `field-labels.spec.ts` asserts every canonical path has an entry here.
 */

const PERSON = (role: "groom" | "bride", who: string) => ({
  [`couple.${role}.full_name`]: `Nama lengkap ${who}`,
  [`couple.${role}.nickname`]: `Nama panggilan ${who}`,
  [`couple.${role}.photo`]: `Foto ${who}`,
  [`couple.${role}.instagram`]: `Instagram ${who}`,
  [`couple.${role}.father_name`]: `Nama ayah ${who}`,
  [`couple.${role}.mother_name`]: `Nama ibu ${who}`,
  [`couple.${role}.child_order`]: `Anak ke- ${who}`,
});

const EVENT = {
  events: "Daftar acara",
  "events.*.type": "Jenis acara",
  "events.*.title": "Nama acara",
  "events.*.date": "Tanggal acara",
  "events.*.start_time": "Jam mulai acara",
  "events.*.end_time": "Jam selesai acara",
  "events.*.venue_name": "Nama tempat acara",
  "events.*.address": "Alamat acara",
  "events.*.latitude": "Lintang lokasi acara",
  "events.*.longitude": "Bujur lokasi acara",
  "events.*.maps_url": "Tautan peta acara",
  "events.*.description": "Catatan acara",
};

const GALLERY = {
  "gallery.photos": "Foto galeri",
  "gallery.photos.*.media_id": "Berkas foto galeri",
  "gallery.photos.*.caption": "Keterangan foto galeri",
  "gallery.photos.*.order": "Urutan foto galeri",
  "gallery.photos.*.is_cover": "Foto sampul",
};

const GIFT = {
  "gift.accounts": "Daftar rekening hadiah",
  "gift.accounts.*.type": "Jenis rekening hadiah",
  "gift.accounts.*.provider_name": "Nama bank atau e-wallet",
  "gift.accounts.*.account_number": "Nomor rekening hadiah",
  "gift.accounts.*.account_holder": "Nama pemilik rekening",
  "gift.accounts.*.order": "Urutan rekening hadiah",
};

/** Every canonical path from `INVITATION_FIELD_PATHS`, named for a person to read. */
export const FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ...PERSON("groom", "mempelai pria"),
  ...PERSON("bride", "mempelai wanita"),
  ...EVENT,
  ...GALLERY,
  ...GIFT,
  "quote.text": "Isi kutipan",
  "quote.source": "Sumber kutipan",
});

/**
 * The section names `docs/UI-UX/14` § Section Order uses, so a checklist can say which
 * part of the invitation to open.
 */
export const SECTION_LABELS: Readonly<Record<SectionKey, string>> =
  Object.freeze({
    hero: "Sampul",
    couple: "Mempelai",
    quote: "Kutipan",
    event: "Acara",
    gallery: "Galeri",
    maps: "Lokasi",
    gift: "Hadiah",
    rsvp: "Konfirmasi kehadiran",
    guestbook: "Buku tamu",
    closing: "Penutup",
  });

export function fieldLabel(path: string): string {
  // The path itself as the last resort. A definition may name a path this package does
  // not know -- `P0-20` validates against the registry, so that should be impossible, and
  // showing the raw path is still better than showing nothing at all.
  return FIELD_LABELS[path] ?? path;
}

export function sectionLabel(key: string): string {
  return (SECTION_LABELS as Record<string, string>)[key] ?? key;
}

/**
 * One missing field, as a sentence.
 *
 * "Nama panggilan mempelai wanita di bagian Mempelai" — the field and where to find it,
 * which is what turns a list of problems into a list of actions.
 */
export function describeMissingField(missing: {
  readonly sectionKey: string;
  readonly path: string;
}): string {
  return `${fieldLabel(missing.path)} di bagian ${sectionLabel(missing.sectionKey)}`;
}

/** For the coverage test, and for anyone checking this file is still complete. */
export const LABELLED_PATHS: readonly string[] = Object.keys(FIELD_LABELS);
export const KNOWN_SECTION_KEYS: readonly SectionKey[] = SECTION_KEYS;
export const CANONICAL_PATHS: readonly string[] = INVITATION_FIELD_PATHS;
