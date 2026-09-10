/**
 * P0-20 — the dot-notation resolver.
 *
 * Used by `docs/BACKEND/03` § Validating Completeness (publish is blocked when a
 * required field is empty, BR-4.2) and by `docs/FRONTEND/04` § Render Flow step 4 (the
 * renderer extracts each section's data subset by path).
 *
 * It lives in `@wi/schema` because those are two different processes reaching the same
 * conclusion about the same invitation. If the editor thinks a field is filled and the
 * publish endpoint thinks it is empty, the user gets an error they cannot act on -- and
 * that is what two implementations of "is this empty" produce within a month.
 *
 * **It never fetches.** It is a pure function over an already-assembled object. That is
 * a security property, not a style preference: a resolver that could load data would be
 * a second data-access path with no tenant scope, which is exactly what
 * `scripts/check-tenant-scope.mjs` exists to prevent. Keeping it in a package with no
 * database dependency makes it structural instead of a rule someone has to remember.
 */

/** Segments that are never data. See `walk()`. */
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/** The wildcard segment: "every element of this collection". */
export const WILDCARD = "*";

/**
 * Resolve a dot path against an invitation object.
 *
 * Returns `undefined` for anything absent -- a missing key, a null parent, an index into
 * a non-array. It does **not** throw. A resolver that threw would turn a half-filled
 * draft into a 500 on the publish endpoint, telling the user nothing; `undefined` is
 * empty, so the same case becomes "this field is still missing", which is true and
 * actionable.
 *
 * A path containing `*` returns an **array**, one entry per element of the collection,
 * in order. `resolvePath(data, "events.*.date")` over two events gives
 * `["2026-11-14", undefined]` -- which is the information `isPathMissing` needs and a
 * flattened or filtered result would have destroyed.
 */
export function resolvePath(data: unknown, path: string): unknown {
  return walk(data, path.split("."));
}

function walk(current: unknown, segments: readonly string[]): unknown {
  if (segments.length === 0) return current;
  if (current === null || current === undefined) return undefined;

  const [segment, ...rest] = segments as [string, ...string[]];

  if (segment === WILDCARD) {
    // A wildcard over something that is not a collection is not an error worth
    // throwing over -- it is an absent collection, which is what `undefined` means
    // everywhere else in this function.
    if (!Array.isArray(current)) return undefined;
    return current.map((element) => walk(element, rest));
  }

  // `data.__proto__.polluted` would otherwise read (and, in a careless writer, write)
  // the prototype chain. Template definitions are admin-authored, and "the input is
  // trusted" is the sentence that precedes most prototype-pollution advisories. The
  // registry check in `template/section.schema.ts` already rejects such a path; this is
  // the second lock, on the assumption the first one is ever bypassed or removed.
  if (FORBIDDEN_SEGMENTS.has(segment)) return undefined;

  if (Array.isArray(current)) {
    const index = Number(segment);
    if (!Number.isInteger(index) || index < 0) return undefined;
    return walk(current[index], rest);
  }

  if (typeof current !== "object") return undefined;

  // `Object.hasOwn` rather than `in`, so an inherited key cannot answer for the object.
  if (!Object.hasOwn(current, segment)) return undefined;
  return walk((current as Record<string, unknown>)[segment], rest);
}

/**
 * Is this value "empty" for the purposes of BR-4.2?
 *
 * The DoD asks for these semantics to be explicit and tested, because they are the
 * difference between blocking a publish and allowing a blank page:
 *
 * | Value | Empty | Why |
 * |---|---|---|
 * | `null`, `undefined` | yes | Nothing there |
 * | `""` | yes | Nothing there |
 * | `"   "` | yes | A name of three spaces is not a name, and it survives sanitization |
 * | `[]` | yes | A gallery with no photos is an empty gallery |
 * | `{}` | yes | An object with no keys carries no field either |
 * | `0` | **no** | A legitimate `order` |
 * | `false` | **no** | A legitimate `is_cover` |
 * | `"0"` | **no** | A string with content |
 *
 * The last three are why this is a function and not `!value`.
 */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Date) return Number.isNaN(value.getTime());
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/**
 * Is the value at this path missing, for publish validation?
 *
 * For a plain path this is `isEmpty(resolvePath(...))`.
 *
 * For a **wildcard** path it is deliberately stricter: missing when the collection is
 * empty **or when any element's value is empty**. Two events where one has no date is
 * not a publishable invitation. The other reading -- "some event has a date, that will
 * do" -- publishes a page with a blank event card on it, which is the outcome BR-4.2
 * exists to prevent. Security-adjacent or not, this is the fail-closed choice, and
 * `docs/SECURITY/00` § Core Security Principles asks for that by default.
 */
export function isPathMissing(data: unknown, path: string): boolean {
  const resolved = resolvePath(data, path);

  if (!path.includes(WILDCARD)) return isEmpty(resolved);

  if (!Array.isArray(resolved) || resolved.length === 0) return true;
  return flatten(resolved).some(isEmpty);
}

/**
 * Flatten nested wildcard results.
 *
 * The registry has no path with two wildcards today. This handles it anyway, because
 * the alternative is `isEmpty([[undefined]])` answering `false` -- a nested array is
 * non-empty, so a path with two wildcards would silently report "present" for data that
 * is entirely absent. A one-line guard against a whole class of wrong answer.
 */
function flatten(values: readonly unknown[]): unknown[] {
  return values.flatMap((v) => (Array.isArray(v) ? flatten(v) : [v]));
}
