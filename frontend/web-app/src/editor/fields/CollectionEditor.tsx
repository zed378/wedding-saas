"use client";

import { useState, type ReactNode } from "react";

import { useAuth } from "../../lib/auth";
import { toFriendlyError } from "../../lib/error-messages";
import { useEditor, useEditorContext } from "../EditorProvider";
import { getAtPath } from "../store";
import { toApiBody, type CollectionEndpoint } from "../transport";
import { FieldControl } from "./FieldControl";
import {
  COLLECTION_ITEM_LABELS,
  ZONE_FIELD,
  collectionFieldNames,
  fieldMeta,
} from "./registry";
import { timezoneForRegionCode } from "@wi/schema";

/**
 * `P2-15` — a collection edited row by row: events, gift accounts. `docs/UI-UX/12`.
 *
 * ## Existing rows save like any other field
 *
 * Each row's fields are ordinary controls bound to `<collection>.<row id>.<field>`, so an edit
 * goes through the same store and the same debounced autosave as a scalar, and the transport
 * turns the path into a `PATCH` on that row's sub-resource. Nothing about rows is special once
 * a row exists.
 *
 * ## A new row is created in one request
 *
 * `docs/API/04` refuses a row without its required fields — an event needs a type, a title, a
 * date, a start time, a venue and an address. An empty row saved field by field would be
 * refused at the first keystroke. So "Tambah" opens a small form, the row is `POST`ed when it
 * is complete, and the stored row (with its server id) is what joins the list.
 *
 * ## Deleting flushes first
 *
 * A pending edit to the row being deleted would otherwise be sent after the delete and fail
 * against a row that no longer exists — a "failed to save" for something the user threw away.
 */

export interface CollectionEditorProps {
  readonly collection: CollectionEndpoint;
  /** The fields the template draws, in its order, and whether it requires them. */
  readonly fields: readonly {
    readonly name: string;
    readonly required: boolean;
  }[];
  /** The template lists the bare collection: offer every field a row has. */
  readonly allFields: boolean;
  readonly renderField: (path: string, required: boolean) => ReactNode;
}

export function CollectionEditor({
  collection,
  fields,
  allFields,
  renderField,
}: CollectionEditorProps) {
  const { api } = useAuth();
  const { store, autosave } = useEditorContext();
  const invitationId = useEditor((state) => state.invitationId);
  const rows = useEditor((state) => {
    const value = getAtPath(state.data, collection.path);
    return Array.isArray(value) ? (value as Record<string, unknown>[]) : EMPTY;
  });

  const itemLabel = COLLECTION_ITEM_LABELS[collection.path] ?? "Item";
  const shown = allFields
    ? collectionFieldNames(collection.path).map((name) => ({
        name,
        required: fields.find((f) => f.name === name)?.required ?? false,
      }))
    : fields;

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  /**
   * The create form asks for what the API needs and what the template draws — minus a map or
   * a photo, which are set on the row once it exists.
   */
  const createFields = [
    ...new Set([...collection.required, ...shown.map((f) => f.name)]),
  ].filter((name) => {
    const type = fieldMeta(`${collection.path}.*.${name}`)?.type;
    return type !== undefined && type !== "map-picker" && type !== "photo";
  });

  const startAdding = () => {
    setDraft({ ...collection.defaults });
    setMessage("");
    setAdding(true);
  };

  const create = async () => {
    const missing = collection.required.filter((name) => {
      const value = draft[name];
      return (
        value === undefined || value === null || String(value).trim() === ""
      );
    });
    if (missing.length > 0) {
      setMessage("Lengkapi isian bertanda * terlebih dahulu.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const result = await api.request<Record<string, unknown>>(
        collection.createPath(invitationId),
        { method: "POST", body: toApiBody(collection, draft) },
      );
      const current = getAtPath(store.getState().data, collection.path);
      store
        .getState()
        .applyServerValue(collection.path, [
          ...(Array.isArray(current) ? current : []),
          collection.fromApi(result.data),
        ]);
      setAdding(false);
      setDraft({});
      setMessage(`${itemLabel} ditambahkan.`);
    } catch (error) {
      setMessage(toFriendlyError(error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rowId: string) => {
    setMessage("");
    try {
      await autosave.flush();
      await api.request(collection.rowPath(invitationId, rowId), {
        method: "DELETE",
      });
      const current = getAtPath(store.getState().data, collection.path);
      store.getState().applyServerValue(
        collection.path,
        (Array.isArray(current) ? current : []).filter(
          (row) => (row as { id?: unknown }).id !== rowId,
        ),
      );
      setMessage(`${itemLabel} dihapus.`);
    } catch (error) {
      setMessage(toFriendlyError(error).message);
    }
  };

  return (
    <div className="space-y-4">
      {rows.length === 0 && !adding && (
        <p className="text-sm text-text-muted">
          Belum ada {itemLabel.toLowerCase()}.
        </p>
      )}

      {rows.map((row, index) => {
        const id = String(row["id"]);
        return (
          <fieldset
            key={id}
            className="space-y-4 rounded-md border border-border p-3"
          >
            <legend className="px-1 text-sm font-semibold text-text">
              {itemLabel} {index + 1}
            </legend>
            {shown.map(({ name, required }) =>
              renderField(`${collection.path}.${id}.${name}`, required),
            )}
            <button
              type="button"
              onClick={() => void remove(id)}
              className="focus-ring min-h-9 rounded-md border border-border px-3 text-sm font-medium text-danger-700"
            >
              Hapus {itemLabel.toLowerCase()} {index + 1}
            </button>
          </fieldset>
        );
      })}

      {adding ? (
        <fieldset className="space-y-4 rounded-md border border-dashed border-border p-3">
          <legend className="px-1 text-sm font-semibold text-text">
            {itemLabel} baru
          </legend>
          {createFields.map((name) => {
            const meta = fieldMeta(`${collection.path}.*.${name}`)!;
            return (
              <FieldControl
                key={name}
                path={`${collection.path}.new.${name}`}
                meta={meta}
                value={draft[name]}
                required={collection.required.includes(name)}
                onChange={(next) => {
                  setDraft((current) => ({
                    ...current,
                    [name]: next,
                    // `P2-17`: a region chosen for a new row sets its zone too, so the default
                    // WIB in the draft does not override the province's zone on the server.
                    ...(meta.type === "region" && typeof next === "string"
                      ? zoneFromRegion(next)
                      : {}),
                  }));
                }}
              />
            );
          })}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void create()}
              className="focus-ring min-h-11 rounded-md bg-primary-600 px-4 text-sm font-medium text-text-inverse disabled:opacity-60"
            >
              {busy ? "Menyimpan…" : `Simpan ${itemLabel.toLowerCase()}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setMessage("");
              }}
              className="focus-ring min-h-11 rounded-md border border-border px-4 text-sm font-medium text-text"
            >
              Batal
            </button>
          </div>
        </fieldset>
      ) : (
        <button
          type="button"
          onClick={startAdding}
          className="focus-ring min-h-9 rounded-md border border-border px-3 text-sm font-medium text-text"
        >
          Tambah {itemLabel.toLowerCase()}
        </button>
      )}

      <p
        role="status"
        aria-live="polite"
        className="min-h-5 text-sm text-text-muted"
      >
        {message}
      </p>
    </div>
  );
}

const EMPTY: Record<string, unknown>[] = [];

function zoneFromRegion(code: string): Record<string, string> {
  const zone = timezoneForRegionCode(code);
  return zone === undefined ? {} : { [ZONE_FIELD]: zone };
}
