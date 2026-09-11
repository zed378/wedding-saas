import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createTokenStore } from "./token-store.js";

/** Strip block and line comments, so prose about a rule is not a breach of it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*/g, " ");
}

/**
 * P0-22 — the access token never reaches persistent storage.
 *
 * `docs/FRONTEND/02` § Auth Token Storage, and the DoD: "The API client has no code path
 * that writes an access token to persistent storage."
 *
 * That is a claim about **absence**, which is the hardest kind to test. Two tests below
 * attack it from different directions: one proves the store forgets across instances,
 * and one reads the package's own source and asserts no storage API is named in it.
 */

describe("createTokenStore", () => {
  it("holds and returns a token", () => {
    const store = createTokenStore();
    expect(store.get()).toBeUndefined();

    store.set("abc");
    expect(store.get()).toBe("abc");
  });

  it("clears", () => {
    const store = createTokenStore();
    store.set("abc");
    store.clear();
    expect(store.get()).toBeUndefined();
  });

  it("notifies subscribers on set and clear", () => {
    const store = createTokenStore();
    const seen: (string | undefined)[] = [];
    store.subscribe((t) => seen.push(t));

    store.set("abc");
    store.clear();

    expect(seen).toEqual(["abc", undefined]);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createTokenStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.set("abc");

    expect(listener).not.toHaveBeenCalled();
  });

  it("shares nothing between instances", () => {
    // If the token lived on a module-level object rather than in a closure, a second
    // store would see the first one's token -- and something would eventually
    // serialise that object.
    const a = createTokenStore();
    const b = createTokenStore();

    a.set("a-token");
    expect(b.get()).toBeUndefined();
  });
});

describe("the token never reaches persistent storage", () => {
  /**
   * The structural half of the claim.
   *
   * Reads this package's own source and asserts that no browser storage API is named
   * anywhere in it. A behavioural test cannot prove absence -- it can only prove that
   * the paths it happened to exercise did not persist. This proves there is no such
   * path to exercise.
   *
   * `scripts/check-token-storage.mjs` extends the same check to every other package,
   * because the rule is about the token and not about this file.
   */
  it("names no storage API in any executable line of the package", () => {
    // `process.cwd()` rather than `import.meta.url`: this package emits CommonJS, where
    // `import.meta` is a compile error, and vitest runs with the package root as cwd.
    const here = join(process.cwd(), "src");
    const sources = ["client.ts", "token-store.ts", "errors.ts", "index.ts"];

    for (const name of sources) {
      // Comments are stripped first. The rule is about code: `token-store.ts` says
      // "NEVER in localStorage" in its own documentation, which is the opposite of a
      // violation, and a check that flagged it would be a check people delete.
      const source = stripComments(readFileSync(join(here, name), "utf8"));

      for (const api of [
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "document.cookie",
      ]) {
        expect(source, `${name} names ${api}`).not.toContain(api);
      }
    }
  });

  it("would catch a storage write if one were added", () => {
    // The mutation, inline: without this the test above passes on an empty string and
    // nobody would know.
    const mutant = stripComments(
      'function save(t) { /* keep it */ localStorage.setItem("access_token", t); }',
    );
    expect(mutant).toContain("localStorage");
  });
});
