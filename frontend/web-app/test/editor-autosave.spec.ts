import { beforeEach, describe, expect, it, vi } from "vitest";

import { AutosaveManager, type SaveGroup } from "../src/editor/autosave";
import { defaultGroupFor } from "../src/editor/transport";
import { createEditorStore, getAtPath, setAtPath } from "../src/editor/store";

/**
 * P1-22 — the store and the autosave manager.
 *
 * Every one of this card's DoD items is a claim about what survives a failure:
 *
 *   a hundred edits in sequence lose nothing;
 *   a failed save keeps local state and offers a retry;
 *   the status never says "Saved" while a request is in flight or has failed;
 *   a concurrent edit warns rather than overwriting.
 *
 * So the tests are mostly about the paths a working editor never takes.
 */

describe("setAtPath", () => {
  it("does not mutate, because the preview and the panel share the object", () => {
    // Mutating in place leaves every subscriber holding the same reference, so the preview
    // renders the old value until something else happens to re-render it — the "preview is
    // one keystroke behind" bug, invisible to a test that reads the store directly.
    const before = { couple: { groom: { nickname: "Budi" } } };
    const after = setAtPath(before, "couple.groom.nickname", "Bud");

    expect(before.couple.groom.nickname).toBe("Budi");
    expect(getAtPath(after, "couple.groom.nickname")).toBe("Bud");
    expect(after.couple).not.toBe(before.couple);
  });

  it("creates the objects it passes through", () => {
    expect(getAtPath(setAtPath({}, "a.b.c", 1), "a.b.c")).toBe(1);
  });

  it("replaces a non-object standing where an object is needed", () => {
    // A field that used to be a string and is now a group. Better to overwrite than to throw
    // in the middle of somebody's typing.
    expect(getAtPath(setAtPath({ a: "x" }, "a.b", 1), "a.b")).toBe(1);
  });
});

describe("defaultGroupFor", () => {
  it.each([
    ["couple.groom.nickname", "couple:groom"],
    ["couple.bride.full_name", "couple:bride"],
    ["settings.rsvp_enabled", "settings"],
    ["quote.text", "quote"],
    ["events.abc-123.title", "events:abc-123"],
    ["internal_name", "internal_name"],
  ])("maps %s to %s", (path, key) => {
    expect(defaultGroupFor(path)).toBe(key);
  });

  it("keeps the two people apart", () => {
    // One PATCH endpoint each (`docs/API/04`). Grouping them together would send the bride's
    // name to the groom's endpoint.
    expect(defaultGroupFor("couple.groom.nickname")).not.toBe(
      defaultGroupFor("couple.bride.nickname"),
    );
  });
});

describe("the editor store", () => {
  it("marks a field dirty and reflects it immediately", () => {
    const store = createEditorStore({ invitationId: "i1" });

    store.getState().setField("couple.groom.nickname", "Budi");

    expect(getAtPath(store.getState().data, "couple.groom.nickname")).toBe(
      "Budi",
    );
    expect([...store.getState().dirtyFields]).toEqual([
      "couple.groom.nickname",
    ]);
  });

  it("stops saying 'Saved' the moment something is edited (DoD 3)", () => {
    // "Saved 3 seconds ago" beside an edited field is a lie, and `docs/UI-UX/12` makes the
    // indicator's trustworthiness the feature.
    const store = createEditorStore({ invitationId: "i1" });
    store.getState().setField("quote.text", "a");
    store.getState().markSaved(["quote.text"]);
    expect(store.getState().saveStatus).toBe("saved");

    store.getState().setField("quote.text", "ab");

    expect(store.getState().saveStatus).toBe("idle");
  });

  it("keeps a field dirty when it changed again during the save (DoD 1)", () => {
    // The keystroke that arrives while the request is out. Clearing the whole dirty set on
    // success would mark it saved, and it would never be sent.
    const store = createEditorStore({ invitationId: "i1" });
    store.getState().setField("quote.text", "a");
    store.getState().beginSave(["quote.text"]);

    store.getState().setField("quote.source", "b");
    store.getState().markSaved(["quote.text"]);

    expect([...store.getState().dirtyFields]).toEqual(["quote.source"]);
    expect(store.getState().saveStatus).toBe("idle");
  });

  it("preserves everything on a failed save (DoD 2)", () => {
    const store = createEditorStore({ invitationId: "i1" });
    store.getState().setField("quote.text", "sebuah kutipan");
    store.getState().beginSave(["quote.text"]);

    store.getState().markFailed(["quote.text"], "Gagal menyimpan.");

    expect(getAtPath(store.getState().data, "quote.text")).toBe(
      "sebuah kutipan",
    );
    // Still dirty: the work is still unsaved, and a retry needs to know what to send.
    expect([...store.getState().dirtyFields]).toEqual(["quote.text"]);
    expect(store.getState().saveStatus).toBe("error");
    expect(store.getState().failure?.fields).toEqual(["quote.text"]);
  });

  it("clears the error when the user edits again, without clearing the data", () => {
    // They are retrying by hand. Leaving "failed to save" on screen while they type is the
    // indicator lying in the other direction.
    const store = createEditorStore({ invitationId: "i1" });
    store.getState().setField("quote.text", "a");
    store.getState().markFailed(["quote.text"], "Gagal.");

    store.getState().setField("quote.text", "ab");

    expect(store.getState().saveStatus).toBe("idle");
    expect(store.getState().failure).toBeUndefined();
    expect(getAtPath(store.getState().data, "quote.text")).toBe("ab");
  });

  it("is per session, not a module singleton", () => {
    // A `create()` at module scope would share state between two invitations opened in one
    // tab, and between two tests.
    const a = createEditorStore({ invitationId: "a" });
    const b = createEditorStore({ invitationId: "b" });

    a.getState().setField("quote.text", "from a");

    expect(getAtPath(b.getState().data, "quote.text")).toBeUndefined();
  });

  it("records the server's updated_at so a conflict can be detected (DoD 4)", () => {
    const store = createEditorStore({
      invitationId: "i1",
      knownUpdatedAt: "2026-09-01T00:00:00.000Z",
    });

    store.getState().markSaved([], "2026-09-02T00:00:00.000Z");

    expect(store.getState().knownUpdatedAt).toBe("2026-09-02T00:00:00.000Z");
  });
});

describe("the autosave manager", () => {
  let saved: SaveGroup[];
  let began: string[][];
  let succeeded: string[][];
  let failed: { fields: string[]; message: string }[];

  const callbacks = {
    onBeginSave: (fields: readonly string[]) => {
      began.push([...fields]);
    },
    onSaved: (fields: readonly string[]) => {
      succeeded.push([...fields]);
    },
    onFailed: (fields: readonly string[], message: string) => {
      failed.push({ fields: [...fields], message });
    },
  };

  beforeEach(() => {
    saved = [];
    began = [];
    succeeded = [];
    failed = [];
    vi.useFakeTimers();
  });

  const manager = (
    save: (group: SaveGroup) => Promise<{ updatedAt?: string } | void>,
    debounceMs = 1_200,
  ) =>
    new AutosaveManager({
      transport: {
        save: async (group) => {
          saved.push({ key: group.key, fields: [...group.fields] });
          return save(group);
        },
      },
      callbacks,
      groupFor: defaultGroupFor,
      debounceMs,
    });

  it("coalesces a burst of keystrokes into one request (step 6)", async () => {
    const m = manager(async () => undefined);

    for (const value of ["B", "Bu", "Bud", "Budi"]) {
      void value;
      m.queue("couple.groom.nickname");
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(1_500);

    expect(saved).toHaveLength(1);
    expect(saved[0]!.fields).toEqual(["couple.groom.nickname"]);
  });

  it("sends one request per sub-resource, not per field", async () => {
    const m = manager(async () => undefined);

    m.queue("couple.groom.nickname");
    m.queue("couple.groom.full_name");
    m.queue("settings.rsvp_enabled");
    await vi.advanceTimersByTimeAsync(1_500);

    expect(saved.map((g) => g.key).sort()).toEqual([
      "couple:groom",
      "settings",
    ]);
    expect(saved.find((g) => g.key === "couple:groom")!.fields).toHaveLength(2);
  });

  it("editing 100 fields in sequence loses nothing (DoD 1)", async () => {
    // `docs/PLAN/17`'s acceptance criterion. Each edit restarts the debounce, so this is
    // also the case where a naive implementation sends nothing at all until the very end.
    const m = manager(async () => undefined);

    for (let i = 0; i < 100; i += 1) {
      m.queue(`settings.field_${String(i)}`);
      await vi.advanceTimersByTimeAsync(200);
    }
    await vi.advanceTimersByTimeAsync(1_500);
    await m.flush();

    const sent = new Set(saved.flatMap((g) => g.fields));
    expect(sent.size).toBe(100);
    for (let i = 0; i < 100; i += 1) {
      expect(sent.has(`settings.field_${String(i)}`)).toBe(true);
    }
    expect(m.hasPending).toBe(false);
  });

  it("never runs two saves at once", async () => {
    // Two overlapping PATCHes to one sub-resource can land in either order, and the loser
    // silently wins.
    let concurrent = 0;
    let peak = 0;
    const m = manager(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((r) => setTimeout(r, 50));
      concurrent -= 1;
    });

    m.queue("settings.a");
    await vi.advanceTimersByTimeAsync(1_300);
    m.queue("settings.b");
    await vi.advanceTimersByTimeAsync(1_300);
    await vi.runAllTimersAsync();

    expect(peak).toBe(1);
  });

  it("sends a keystroke that arrived during a save, in the next cycle", async () => {
    let release: (() => void) | undefined;
    const m = manager(
      async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    m.queue("settings.a");
    await vi.advanceTimersByTimeAsync(1_300);
    expect(saved).toHaveLength(1);

    // Mid-flight.
    m.queue("settings.b");
    release?.();
    await vi.advanceTimersByTimeAsync(1_500);
    await vi.runAllTimersAsync();

    expect(saved.flatMap((g) => g.fields)).toContain("settings.b");
  });

  it("keeps failed fields queued so a retry has something to send (DoD 2)", async () => {
    let attempt = 0;
    const m = manager(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("Jaringan bermasalah.");
    });

    m.queue("quote.text");
    await vi.advanceTimersByTimeAsync(1_300);

    expect(failed).toHaveLength(1);
    expect(m.hasPending).toBe(true);

    // The manual retry `docs/UI-UX/12` asks for.
    await m.flush();

    expect(succeeded.flat()).toContain("quote.text");
    expect(m.hasPending).toBe(false);
  });

  it("does not retry automatically", async () => {
    // A silent retry loop against a server rejecting the data is a spinner that never stops.
    const m = manager(async () => {
      throw new Error("nope");
    });

    m.queue("quote.text");
    await vi.advanceTimersByTimeAsync(1_300);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(saved).toHaveLength(1);
  });

  it("a failing sub-resource does not hold the others hostage", async () => {
    const m = manager(async (group) => {
      if (group.key === "events:e1") throw new Error("nope");
    });

    m.queue("events.e1.title");
    m.queue("couple.groom.nickname");
    await vi.advanceTimersByTimeAsync(1_300);

    expect(succeeded.flat()).toContain("couple.groom.nickname");
    expect(failed[0]!.fields).toEqual(["events.e1.title"]);
  });

  it("flushes on stop, so navigating away does not drop the last sentence", async () => {
    const m = manager(async () => undefined);

    m.queue("quote.text");
    // No timer advance: the debounce has not fired.
    await m.stop();

    expect(saved.flatMap((g) => g.fields)).toEqual(["quote.text"]);
  });

  it("accepts nothing after stop", async () => {
    const m = manager(async () => undefined);
    await m.stop();

    m.queue("quote.text");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(saved).toHaveLength(0);
  });

  it("reports the server's updated_at back to the caller", async () => {
    const seen: (string | undefined)[] = [];
    const m = new AutosaveManager({
      transport: { save: async () => ({ updatedAt: "2026-09-02T00:00:00Z" }) },
      groupFor: defaultGroupFor,
      callbacks: {
        onBeginSave: () => undefined,
        onSaved: (_fields, updatedAt) => {
          seen.push(updatedAt);
        },
        onFailed: () => undefined,
      },
      debounceMs: 10,
    });

    m.queue("quote.text");
    await vi.advanceTimersByTimeAsync(50);

    expect(seen).toEqual(["2026-09-02T00:00:00Z"]);
  });
});
