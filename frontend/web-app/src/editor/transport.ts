import type { ApiClient } from "@wi/api-client";
import { DEFAULT_EVENT_TIMEZONE } from "@wi/schema";

import { getAtPath } from "./store";
import type { AutosaveTransport, SaveGroup, SaveGroupKey } from "./autosave";
import type { FieldPath } from "./store";

/**
 * P1-22, P2-15 — the one file that knows `docs/API/04`'s shape, in both directions.
 *
 * The editor works in `docs/PLAN/08`'s **canonical** shape: the field registry, the
 * properties panel and the renderer all address `events.*.date`, `gift.accounts.*` and
 * `gallery.photos`. The API speaks `docs/API/04`'s: `event_date`, `bank_accounts`, a flat
 * `gallery` array and a sub-resource per row. This file translates between them —
 * `toEditorDocument` on the way in, `endpointFor` and `COLLECTIONS` on the way out — so no
 * component, and no other module, needs to know that both shapes exist.
 *
 * `P1-22` put only the outbound half here and loaded the API's shape straight into the store.
 * Every path the panel wrote then missed: an event edit went to `PATCH /events/*`, nothing
 * reached the API, and the live preview showed no event date and no gift account for any real
 * invitation (`P2-15`). The inbound half now lives beside the outbound one, so the two cannot
 * drift apart without one file showing it.
 *
 * ## The body is built from the store, not from the change
 *
 * A group carries **paths**, and the values are read out of the current store state at send
 * time. So a field edited three times during one debounce sends its latest value, and a field
 * edited again while the request was out sends its newer value on the next cycle rather than
 * an older one captured when the keystroke happened.
 *
 * ## Rows are addressed by id
 *
 * A collection row's path carries its id — `events.<uuid>.title` — never its index, so a save
 * queued for one row cannot land on a neighbour after a deletion (`store.ts` § Rows are
 * addressed by id). The id is also the sub-resource's, which is what makes the endpoint a
 * lookup.
 */

export interface TransportDeps {
  readonly api: ApiClient;
  readonly invitationId: string;
  /** Read at send time, so the latest value is what goes. */
  readonly readData: () => Readonly<Record<string, unknown>>;
}

interface Endpoint {
  readonly path: string;
  /** The API's field name for a canonical path, e.g. `events.<id>.date` → `event_date`. */
  readonly fieldName: (path: string) => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------------------------
// Inbound: the owner detail, as the editor document.
// ---------------------------------------------------------------------------------------------

/** Media URLs by media id, joined from `GET /invitations/:id/gallery` so the preview can draw. */
export type MediaUrls = ReadonlyMap<
  string,
  {
    readonly url?: string | undefined;
    readonly medium_url?: string | undefined;
    readonly thumbnail_url?: string | undefined;
  }
>;

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value)
    ? value.filter((row): row is Row => typeof row === "object" && row !== null)
    : [];

const byOrder = (list: Row[]): Row[] =>
  [...list].sort(
    (a, b) => Number(a["display_order"] ?? 0) - Number(b["display_order"] ?? 0),
  );

/** `docs/API/04`'s event row → `docs/PLAN/08`'s. Also used for a row the API just created. */
export function eventFromApi(row: Row): Row {
  return {
    id: row["id"],
    type: row["type"],
    title: row["title"],
    date: row["event_date"],
    start_time: row["start_time"],
    end_time: row["end_time"] ?? null,
    timezone: row["timezone"] ?? DEFAULT_EVENT_TIMEZONE,
    region_code: row["region_code"] ?? null,
    venue_name: row["venue_name"],
    address: row["address"],
    latitude: row["latitude"] ?? null,
    longitude: row["longitude"] ?? null,
    maps_url: row["maps_url"] ?? null,
    description: row["description"] ?? null,
    order: row["display_order"],
  };
}

/** Where the editor document keeps the gallery. */
export const GALLERY_PHOTOS_PATH = "gallery.photos";

/** `docs/API/04`'s gallery row (with the URLs the gallery list adds) → `docs/PLAN/08`'s photo. */
export function galleryPhotoFromApi(
  row: Readonly<Record<string, unknown>>,
  urls?: {
    readonly url?: string | undefined;
    readonly medium_url?: string | undefined;
    readonly thumbnail_url?: string | undefined;
  },
): Row {
  const url = urls?.url ?? row["url"];
  const medium = urls?.medium_url ?? row["medium_url"];
  const thumbnail = urls?.thumbnail_url ?? row["thumbnail_url"];
  return {
    id: row["id"],
    media_id: row["media_id"],
    caption: row["caption"] ?? null,
    is_cover: row["is_cover"] === true,
    order: row["display_order"],
    ...(typeof url === "string" ? { url } : {}),
    ...(typeof medium === "string" ? { medium_url: medium } : {}),
    ...(typeof thumbnail === "string" ? { thumbnail_url: thumbnail } : {}),
  };
}

/** `docs/API/04`'s bank account row → `docs/PLAN/08`'s gift account. */
export function accountFromApi(row: Row): Row {
  return {
    id: row["id"],
    type: row["type"],
    provider_name: row["provider_name"],
    account_number: row["account_number"],
    account_holder: row["account_holder"],
    order: row["display_order"],
  };
}

function personFromApi(person: unknown, media: MediaUrls): Row | null {
  if (typeof person !== "object" || person === null) return null;
  const row = person as Row;
  const photoId = row["photo_media_id"];
  const urls = typeof photoId === "string" ? media.get(photoId) : undefined;
  return {
    full_name: row["full_name"],
    nickname: row["nickname"],
    instagram: row["instagram"] ?? null,
    father_name: row["father_name"] ?? null,
    mother_name: row["mother_name"] ?? null,
    child_order: row["child_order"] ?? null,
    photo_media_id: photoId ?? null,
    // The canonical `photo` is an image source, as the public payload serves it (ADR-063).
    ...(urls?.thumbnail_url === undefined ? {} : { photo: urls.thumbnail_url }),
  };
}

/**
 * `GET /invitations/:id` → the editor document, in `docs/PLAN/08`'s canonical shape.
 *
 * Everything the detail carries that is not reshaped passes through unchanged (`template`,
 * `settings`, `quote`, the identifiers), so the rest of the editor keeps reading what it read.
 */
export function toEditorDocument(
  detail: Readonly<Record<string, unknown>>,
  media: MediaUrls = new Map(),
): Record<string, unknown> {
  const {
    couple,
    events,
    gallery,
    bank_accounts: bankAccounts,
    ...rest
  } = detail as Row;

  const pair =
    typeof couple === "object" && couple !== null ? (couple as Row) : {};

  return {
    ...rest,
    couple: {
      groom: personFromApi(pair["groom"], media),
      bride: personFromApi(pair["bride"], media),
    },
    events: byOrder(rows(events)).map(eventFromApi),
    gallery: {
      photos: byOrder(rows(gallery)).map((row) =>
        galleryPhotoFromApi(
          row,
          typeof row["media_id"] === "string"
            ? media.get(row["media_id"])
            : undefined,
        ),
      ),
    },
    gift: { accounts: byOrder(rows(bankAccounts)).map(accountFromApi) },
  };
}

// ---------------------------------------------------------------------------------------------
// Outbound: canonical paths → sub-resources.
// ---------------------------------------------------------------------------------------------

/**
 * The collections the editor edits row by row, and how each maps onto its sub-resource.
 *
 * `required` is what the API refuses a new row without (`docs/API/04`), in canonical field
 * names — which can be more than a template's own `required_fields`, since a template that
 * does not display an event's type still cannot create an event without one.
 */
export interface CollectionEndpoint {
  /** The canonical path of the list, e.g. `events`. */
  readonly path: string;
  readonly createPath: (invitationId: string) => string;
  readonly rowPath: (invitationId: string, rowId: string) => string;
  /** Canonical field name → the API's. Unlisted names are the same in both. */
  readonly rename: Readonly<Record<string, string>>;
  readonly fromApi: (row: Row) => Row;
  readonly required: readonly string[];
  /** Values a new row starts with, so a select has a choice before anyone opens it. */
  readonly defaults: Readonly<Record<string, string>>;
}

export const COLLECTIONS: readonly CollectionEndpoint[] = [
  {
    path: "events",
    createPath: (invitationId) => `/invitations/${invitationId}/events`,
    rowPath: (invitationId, rowId) =>
      `/invitations/${invitationId}/events/${rowId}`,
    rename: { date: "event_date", order: "display_order" },
    fromApi: eventFromApi,
    required: ["type", "title", "date", "start_time", "venue_name", "address"],
    defaults: { type: "akad", timezone: DEFAULT_EVENT_TIMEZONE },
  },
  {
    path: "gift.accounts",
    createPath: (invitationId) => `/invitations/${invitationId}/bank-accounts`,
    rowPath: (invitationId, rowId) =>
      `/invitations/${invitationId}/bank-accounts/${rowId}`,
    rename: { order: "display_order" },
    fromApi: accountFromApi,
    required: ["type", "provider_name", "account_number", "account_holder"],
    defaults: { type: "bank" },
  },
];

/** The collection a canonical path belongs to, and the row id in it, if any. */
export function collectionOf(
  path: FieldPath,
):
  { collection: CollectionEndpoint; rowId: string; field: string } | undefined {
  for (const collection of COLLECTIONS) {
    const prefix = `${collection.path}.`;
    if (!path.startsWith(prefix)) continue;
    const [rowId, ...field] = path.slice(prefix.length).split(".");
    if (rowId === undefined || field.length === 0) return undefined;
    return { collection, rowId, field: field.join(".") };
  }
  return undefined;
}

/** A canonical row → the body its sub-resource accepts. */
export function toApiBody(
  collection: CollectionEndpoint,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    body[collection.rename[name] ?? name] = value;
  }
  return body;
}

/**
 * Which save group a path belongs to — one group per request the API needs.
 *
 * `couple.groom.*` is one endpoint and `couple.bride.*` another; each event and each gift
 * account is its own row; everything under `settings.*` is one PATCH. An unknown prefix groups
 * by its first segment rather than throwing — a new sub-resource should produce its own
 * requests, not break the editor.
 */
export function defaultGroupFor(path: FieldPath): SaveGroupKey {
  const row = collectionOf(path);
  if (row !== undefined) return `${row.collection.path}:${row.rowId}`;

  const [head, second] = path.split(".");
  if (head === "couple" && second !== undefined) return `couple:${second}`;
  return head ?? "invitation";
}

/** Where each group goes. `docs/API/04` § Sub-resources. */
function endpointFor(key: string, invitationId: string): Endpoint | undefined {
  const base = `/invitations/${invitationId}`;
  const separator = key.lastIndexOf(":");
  const group = separator === -1 ? key : key.slice(0, separator);
  const id = separator === -1 ? undefined : key.slice(separator + 1);

  const collection = COLLECTIONS.find((c) => c.path === group);
  if (collection !== undefined) {
    // A row without a server id has nowhere to go. An index or a `*` here means a path the
    // editor invented, and saying so beats a PATCH to `/events/0`.
    if (id === undefined || !UUID.test(id)) return undefined;
    return {
      path: collection.rowPath(invitationId, id),
      fieldName: (p) => {
        const field = collectionOf(p)?.field ?? p;
        return collection.rename[field] ?? field;
      },
    };
  }

  switch (group) {
    case "couple":
      return id === undefined
        ? undefined
        : {
            path: `${base}/couple/${id}`,
            fieldName: (p) => {
              const field = p.split(".").slice(2).join(".");
              return field === "photo" ? "photo_media_id" : field;
            },
          };
    case "settings":
      return {
        path: `${base}/settings`,
        fieldName: (p) => p.split(".").slice(1).join("."),
      };
    case "quote":
      return {
        path: `${base}/quote`,
        fieldName: (p) => p.split(".").slice(1).join("."),
      };
    case "internal_name":
      // A field on the invitation itself. `P1-10`'s PATCH accepts exactly one field.
      return { path: base, fieldName: () => "internal_name" };
    default:
      return undefined;
  }
}

export function createTransport(deps: TransportDeps): AutosaveTransport {
  return {
    save: async (group: SaveGroup) => {
      const endpoint = endpointFor(group.key, deps.invitationId);

      if (endpoint === undefined) {
        // A group with no endpoint means a field path the editor invented. Throwing surfaces
        // it as a failed save with a retry rather than as a silent no-op that looks like
        // success — the DoD's "never shows Saved when it did not save".
        throw new Error(
          `Tidak ada endpoint untuk bagian "${group.key}". Perubahan belum tersimpan.`,
        );
      }

      const data = deps.readData();
      const body: Record<string, unknown> = {};
      for (const path of group.fields) {
        body[endpoint.fieldName(path)] = getAtPath(data, path);
      }

      const result = await deps.api.request<{ updated_at?: string }>(
        endpoint.path,
        { method: "PATCH", body },
      );

      // `docs/FRONTEND/06` § Conflict Handling compares this against what the client last
      // knew. Absent on endpoints that do not return it, which is why the store treats it as
      // optional rather than resetting to undefined.
      return typeof result.data.updated_at === "string"
        ? { updatedAt: result.data.updated_at }
        : undefined;
    },
  };
}
