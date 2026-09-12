import type { ApiClient } from "@wi/api-client";

import { getAtPath } from "./store";
import type { AutosaveTransport, SaveGroup } from "./autosave";

/**
 * P1-22 — turning a save group into the right `PATCH`. `docs/API/04`.
 *
 * The manager knows nothing about URLs and this knows nothing about debouncing. That split is
 * what lets the manager's tests be about losing work rather than about HTTP, and it is what
 * makes "dispatch to the correct sub-resource" (card step 3) a table rather than a decision
 * spread through the editor.
 *
 * ## The body is built from the store, not from the change
 *
 * A group carries **paths**, and the values are read out of the current store state at send
 * time. So a field edited three times during one debounce sends its latest value, and a field
 * edited again while the request was out sends its newer value on the next cycle rather than
 * an older one captured when the keystroke happened.
 */

export interface TransportDeps {
  readonly api: ApiClient;
  readonly invitationId: string;
  /** Read at send time, so the latest value is what goes. */
  readonly readData: () => Readonly<Record<string, unknown>>;
}

interface Endpoint {
  readonly path: string;
  /** Strips the group prefix, so `couple.groom.nickname` becomes `nickname`. */
  readonly fieldName: (path: string) => string;
}

/**
 * Where each group goes. `docs/API/04` § Sub-resources.
 *
 * `settings` is the only one whose API field names differ from the store's paths — they do
 * not, in fact, which is why this is a prefix strip rather than a rename map. If they ever
 * diverge, this is the one place to say so.
 */
function endpointFor(key: string, invitationId: string): Endpoint | undefined {
  const base = `/invitations/${invitationId}`;
  const [group, id] = key.split(":");

  switch (group) {
    case "couple":
      return id === undefined
        ? undefined
        : {
            path: `${base}/couple/${id}`,
            fieldName: (p) => p.split(".").slice(2).join("."),
          };
    case "events":
      return id === undefined
        ? undefined
        : {
            path: `${base}/events/${id}`,
            fieldName: (p) => p.split(".").slice(2).join("."),
          };
    case "bank_accounts":
      return id === undefined
        ? undefined
        : {
            path: `${base}/bank-accounts/${id}`,
            fieldName: (p) => p.split(".").slice(2).join("."),
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
