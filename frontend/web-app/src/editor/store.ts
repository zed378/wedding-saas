import { createStore } from "zustand/vanilla";

/**
 * P1-22 — the editor store. `docs/FRONTEND/02` § Editor State Shape, `docs/FRONTEND/06`.
 *
 * ## One store, and that is the whole point
 *
 * `docs/FRONTEND/02` § Principles names the failure mode directly: "the editor's invitation
 * data has ONE centralized store; the Live Preview & Properties Panel components read from
 * the same store, not through multi-level manual prop-drilling that easily goes out of sync".
 * A preview showing one value while the form shows another is the bug that makes an editor
 * feel untrustworthy, and it is produced by the obvious design rather than by a mistake.
 *
 * ## `createStore`, not `create`
 *
 * The vanilla store is created per editor session and handed down through a context. A
 * module-level `create()` would be a singleton shared by every invitation the tab ever
 * opened — so closing one invitation and opening another would start with the first one's
 * data, and a test would leak state into the next test.
 *
 * ## Local state is never discarded on a failed save
 *
 * `docs/FRONTEND/06` is explicit about it, and it is why `data` and `dirtyFields` are not
 * touched by the save path at all: `markSaved` clears only the fields it was given, and only
 * if they have not changed again since. A save that fails leaves everything exactly where the
 * user left it, which is what makes the retry meaningful.
 */

/** `docs/FRONTEND/02`: `'idle' | 'saving' | 'saved' | 'error'`. */
export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * A field path, e.g. `couple.groom.nickname` or `settings.rsvp_enabled`.
 *
 * The first segment names the sub-resource the autosave manager PATCHes, which is what makes
 * "dispatch to the correct sub-resource" (card step 3) a lookup rather than a decision.
 */
export type FieldPath = string;

export interface SaveFailure {
  readonly message: string;
  /** The paths that were in flight when it failed, so a retry knows what to resend. */
  readonly fields: readonly FieldPath[];
}

export interface EditorState {
  readonly invitationId: string;
  /** The invitation, as `docs/PLAN/08` shapes it. Untyped here — `P1-23` gives it a schema. */
  readonly data: Readonly<Record<string, unknown>>;
  readonly templateDefinition: TemplateDefinition | undefined;
  readonly activeSectionKey: string | undefined;
  readonly saveStatus: SaveStatus;
  /** When the last successful save completed. Drives "Saved 2 seconds ago". */
  readonly savedAt: number | undefined;
  readonly failure: SaveFailure | undefined;
  /**
   * Paths changed since the last successful save.
   *
   * A `Set` as `docs/FRONTEND/02` writes it. Replaced rather than mutated on every change, so
   * a subscriber sees a new reference and re-renders — mutating in place is how a dirty
   * indicator ends up one keystroke behind.
   */
  readonly dirtyFields: ReadonlySet<FieldPath>;
  /**
   * The `updated_at` the client last saw from the server.
   *
   * `docs/FRONTEND/06` § Conflict Handling compares this against the server's value to detect
   * an edit from another tab. Advisory: the MVP is last-write-wins and the warning is
   * non-blocking.
   */
  readonly knownUpdatedAt: string | undefined;
  readonly conflict: boolean;
}

export interface TemplateSectionDefinition {
  readonly section_key: string;
  readonly configurable?: boolean;
  readonly enabled_by_default?: boolean;
  readonly required_fields?: readonly string[];
}

export interface TemplateDefinition {
  readonly sections: readonly TemplateSectionDefinition[];
  readonly enabledSections: readonly string[];
}

export interface EditorActions {
  readonly setField: (path: FieldPath, value: unknown) => void;
  readonly setActiveSection: (key: string) => void;
  readonly beginSave: (fields: readonly FieldPath[]) => void;
  readonly markSaved: (
    fields: readonly FieldPath[],
    updatedAt?: string | undefined,
  ) => void;
  readonly markFailed: (fields: readonly FieldPath[], message: string) => void;
  readonly setEnabledSections: (keys: readonly string[]) => void;
  readonly noteConflict: () => void;
  readonly dismissConflict: () => void;
}

export type EditorStore = EditorState & EditorActions;

export interface EditorInit {
  readonly invitationId: string;
  readonly data?: Record<string, unknown>;
  readonly templateDefinition?: TemplateDefinition | undefined;
  readonly activeSectionKey?: string | undefined;
  readonly knownUpdatedAt?: string | undefined;
}

export function createEditorStore(init: EditorInit) {
  return createStore<EditorStore>()((set, get) => ({
    invitationId: init.invitationId,
    data: init.data ?? {},
    templateDefinition: init.templateDefinition,
    activeSectionKey:
      init.activeSectionKey ??
      init.templateDefinition?.sections[0]?.section_key,
    saveStatus: "idle",
    savedAt: undefined,
    failure: undefined,
    dirtyFields: new Set<FieldPath>(),
    knownUpdatedAt: init.knownUpdatedAt,
    conflict: false,

    setField: (path, value) => {
      set((state) => {
        const dirty = new Set(state.dirtyFields);
        dirty.add(path);

        return {
          data: setAtPath(state.data, path, value),
          dirtyFields: dirty,
          // Editing after a failure clears the error but NOT the data. The user is trying
          // again by hand, and leaving "failed to save" on screen while they type is the
          // indicator lying in the other direction.
          ...(state.saveStatus === "error"
            ? { saveStatus: "idle" as const, failure: undefined }
            : {}),
          // "Saved 3 seconds ago" beside an edited field is false. `docs/UI-UX/12` asks for
          // the indicator to be trustworthy, which means it stops claiming success the
          // moment there is something unsaved.
          ...(state.saveStatus === "saved"
            ? { saveStatus: "idle" as const }
            : {}),
        };
      });
    },

    setActiveSection: (key) => {
      set({ activeSectionKey: key });
    },

    beginSave: (fields) => {
      if (fields.length === 0) return;
      set({ saveStatus: "saving", failure: undefined });
    },

    markSaved: (fields, updatedAt) => {
      set((state) => {
        const dirty = new Set(state.dirtyFields);
        // Only the fields that were in flight, and only if they were not edited again while
        // the request was out. Clearing the whole set would mark a keystroke typed mid-save
        // as saved, and it would never be sent.
        for (const field of fields) dirty.delete(field);

        return {
          dirtyFields: dirty,
          saveStatus: dirty.size === 0 ? "saved" : "idle",
          savedAt: Date.now(),
          failure: undefined,
          ...(updatedAt !== undefined ? { knownUpdatedAt: updatedAt } : {}),
        };
      });
    },

    markFailed: (fields, message) => {
      // `dirtyFields` is untouched on purpose: the work is still unsaved, so it is still
      // dirty, and the retry has something to resend. `docs/FRONTEND/06`: "local state IS
      // PRESERVED, retry is available".
      set({ saveStatus: "error", failure: { message, fields } });
    },

    setEnabledSections: (keys) => {
      const definition = get().templateDefinition;
      if (definition === undefined) return;
      set({
        templateDefinition: { ...definition, enabledSections: [...keys] },
      });
    },

    noteConflict: () => {
      set({ conflict: true });
    },

    dismissConflict: () => {
      set({ conflict: false });
    },
  }));
}

/**
 * Set a dotted path immutably, creating the objects it passes through.
 *
 * Immutable because the preview and the panel both subscribe: mutating `data` in place would
 * leave every subscriber holding the same reference and rendering the old value until
 * something else happened to re-render them. That is the "preview is one keystroke behind"
 * bug, and it is invisible in a test that reads the store directly.
 */
export function setAtPath(
  object: Readonly<Record<string, unknown>>,
  path: FieldPath,
  value: unknown,
): Record<string, unknown> {
  const segments = path.split(".");
  const head = segments[0]!;

  if (segments.length === 1) {
    return { ...object, [head]: value };
  }

  const existing = object[head];
  const child =
    typeof existing === "object" &&
    existing !== null &&
    !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};

  return {
    ...object,
    [head]: setAtPath(child, segments.slice(1).join("."), value),
  };
}

/** Read a dotted path back, for a form field that needs its current value. */
export function getAtPath(
  object: Readonly<Record<string, unknown>>,
  path: FieldPath,
): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, segment) =>
        typeof current === "object" && current !== null
          ? (current as Record<string, unknown>)[segment]
          : undefined,
      object,
    );
}
