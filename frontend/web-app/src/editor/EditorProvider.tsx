"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useStore } from "zustand";

import { useAuth } from "../lib/auth";
import { AutosaveManager, type AutosaveTransport } from "./autosave";
import { createTransport, defaultGroupFor } from "./transport";
import { createEditorStore, type EditorInit, type EditorStore } from "./store";

/**
 * P1-22 — `EditorProvider`. `docs/FRONTEND/06` § Editor Modules.
 *
 * Owns the store and the autosave manager for one editor session, and nothing else. The
 * panels read the store through `useEditor`; none of them knows the manager exists, which is
 * what keeps "the preview reads local state" (`docs/FRONTEND/06` § Why Not Fetch-on-Every-
 * Keystroke) true by construction rather than by discipline.
 */

interface EditorContextValue {
  readonly store: ReturnType<typeof createEditorStore>;
  readonly autosave: AutosaveManager;
  /** Edit a field: updates the store immediately and queues the save. */
  readonly edit: (path: string, value: unknown) => void;
  /** Send everything now. The retry button behind a failed save. */
  readonly retry: () => Promise<void>;
}

const EditorContext = createContext<EditorContextValue | undefined>(undefined);

export interface EditorProviderProps extends EditorInit {
  readonly children: ReactNode;
  /**
   * Injected by tests. Production builds one from the API client.
   *
   * A **transport**, not a whole `AutosaveManager`: the provider owns the callbacks, and the
   * callbacks are what connect a save to the store. Injecting a manager would mean injecting
   * its callbacks too, and a test that supplied its own would be testing a manager wired to
   * nothing — which is how a suite ends up green while the indicator never moves.
   */
  readonly transport?: AutosaveTransport;
  readonly debounceMs?: number;
}

export function EditorProvider({
  children,
  transport: injectedTransport,
  debounceMs,
  ...init
}: EditorProviderProps) {
  const { api } = useAuth();

  // Created once per session. A `useMemo` keyed on the id rather than a `useState`
  // initialiser, so opening a different invitation in the same mounted tree replaces the
  // store instead of showing the previous invitation's data.
  const store = useMemo(
    () => createEditorStore(init),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the id is the identity of the
    // session; re-creating on every `data` reference change would discard the user's edits.
    [init.invitationId],
  );

  const autosave = useMemo(() => {
    return new AutosaveManager({
      transport:
        injectedTransport ??
        createTransport({
          api,
          invitationId: init.invitationId,
          // A getter, not a snapshot: the manager sends the LATEST value of each path, which
          // is what makes a field edited three times during one debounce send once,
          // correctly.
          readData: () => store.getState().data,
        }),
      groupFor: defaultGroupFor,
      callbacks: {
        onBeginSave: (fields) => {
          store.getState().beginSave(fields);
        },
        onSaved: (fields, updatedAt) => {
          const known = store.getState().knownUpdatedAt;
          store.getState().markSaved(fields, updatedAt);

          // `docs/FRONTEND/06` § Conflict Handling. The server's timestamp moved further
          // than this client's own save explains, so something else wrote in between --
          // another tab, another device. Non-blocking and advisory: the MVP is
          // last-write-wins, and the point is that the user is told rather than that the
          // write is refused.
          if (
            known !== undefined &&
            updatedAt !== undefined &&
            Date.parse(updatedAt) > Date.parse(known) + CONFLICT_TOLERANCE_MS
          ) {
            store.getState().noteConflict();
          }
        },
        onFailed: (fields, message) => {
          store.getState().markFailed(fields, message);
        },
      },
      ...(debounceMs !== undefined ? { debounceMs } : {}),
    });
  }, [api, injectedTransport, init.invitationId, store, debounceMs]);

  // Flush on unmount. A pending debounce discarded on navigation is the quietest way to lose
  // somebody's last sentence, and `docs/PLAN/17`'s acceptance criterion is about exactly that.
  const latest = useRef(autosave);
  latest.current = autosave;
  useEffect(
    () => () => {
      void latest.current.stop();
    },
    [],
  );

  const value = useMemo<EditorContextValue>(
    () => ({
      store,
      autosave,
      edit: (path, editValue) => {
        store.getState().setField(path, editValue);
        autosave.queue(path);
      },
      retry: () => autosave.flush(),
    }),
    [store, autosave],
  );

  return <EditorContext value={value}>{children}</EditorContext>;
}

/**
 * How much later than the client's own save counts as somebody else's write.
 *
 * A save the client made itself moves `updated_at` forward, so a naive "newer than known"
 * check would flag every second save as a conflict. The tolerance absorbs clock skew and the
 * request's own round trip; two seconds is generous for the first and irrelevant to a real
 * concurrent edit, which is minutes apart.
 */
const CONFLICT_TOLERANCE_MS = 2_000;

export function useEditorContext(): EditorContextValue {
  const value = useContext(EditorContext);
  if (value === undefined) {
    throw new Error("useEditor must be used inside an <EditorProvider>.");
  }
  return value;
}

/**
 * Subscribe to a slice of the editor state.
 *
 * A selector rather than the whole state, because the properties panel re-rendering on every
 * keystroke in a different panel is the performance problem `docs/UI-UX/12` is worried about.
 */
export function useEditor<T>(selector: (state: EditorStore) => T): T {
  const { store } = useEditorContext();
  return useStore(store, selector);
}
