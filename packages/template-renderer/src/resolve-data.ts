/**
 * P2-02 step 4 — the dot-notation resolver. `docs/FRONTEND/04` Render Flow step 4.
 *
 * A section declares the data it needs as canonical paths — `couple.groom.nickname`,
 * `gallery.photos`, `events.*.venue_name` — and this turns those into the subset of the
 * invitation the component receives.
 *
 * ## Why the section gets a subset rather than the whole invitation
 *
 * Two reasons, and the second is the one that matters.
 *
 * A component handed the whole object can read anything, so `required_fields` stops
 * describing what it uses and becomes documentation that drifts. More importantly, a
 * section the user has **disabled** must not reach the page — the card's DoD calls a
 * hidden section "still a data leak in the page source" — and the same reasoning applies
 * within a section: the gift accounts have no business being in the hero's props.
 *
 * ## `*` is a collection, and it is not a wildcard search
 *
 * `events.*.venue_name` means "for every event, its venue_name". It resolves to the
 * `events` array with each element narrowed to the requested fields, **not** to a flat
 * list of venue names — a component rendering event cards needs them grouped by event.
 *
 * Only one `*` per path, and only where the field registry declares a collection. A
 * second one would mean nested collections, which `docs/PLAN/08` does not have.
 */

export type InvitationData = Record<string, unknown>;

/**
 * Build the data subset a section may see.
 *
 * Paths that resolve to nothing are simply absent from the result rather than present as
 * `undefined` — `docs/PLAN/07` § Required vs Optional asks that an absent optional field
 * leave no empty element behind, and the cheapest way to keep that promise is for the
 * component never to receive the key.
 */
export function resolveSectionData(
  data: InvitationData,
  paths: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const path of paths) {
    const star = path.indexOf(".*.");

    if (star === -1) {
      const value = readPath(data, path.split("."));
      if (value !== undefined) assignPath(result, path.split("."), value);
      continue;
    }

    // A collection path: everything before `.*.` names the array, everything after names
    // one field on each element.
    const collectionPath = path.slice(0, star).split(".");
    const field = path.slice(star + 3);
    const collection = readPath(data, collectionPath);
    if (!Array.isArray(collection)) continue;

    const existing = readPath(result, collectionPath);
    const target: Record<string, unknown>[] = Array.isArray(existing)
      ? (existing as Record<string, unknown>[])
      : collection.map(() => ({}));

    collection.forEach((element, index) => {
      const value = readPath(element as InvitationData, field.split("."));
      if (value !== undefined) {
        // eslint-disable-next-line security/detect-object-injection -- index is from forEach
        target[index] = { ...target[index], [field]: value };
      }
    });

    assignPath(result, collectionPath, target);
  }

  return result;
}

/**
 * Read one dotted path.
 *
 * Returns `undefined` for anything missing rather than throwing, because a draft
 * invitation being edited is *expected* to be missing fields — `P2-06`'s publish check is
 * where incompleteness is refused, and a preview that crashed on an empty field would
 * make the editor unusable.
 */
export function readPath(
  source: unknown,
  segments: readonly string[],
): unknown {
  let current: unknown = source;

  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    // Prototype keys are not data. Without this, a path of `constructor.prototype` walks
    // out of the object graph and into the language's.
    if (!Object.prototype.hasOwnProperty.call(current, segment))
      return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function assignPath(
  target: Record<string, unknown>,
  segments: readonly string[],
  value: unknown,
): void {
  let current = target;

  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]!;
    // Same reasoning as the read: a path segment must never reach the prototype chain.
    if (isUnsafeKey(key)) return;
    const next = current[key];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const last = segments[segments.length - 1]!;
  if (isUnsafeKey(last)) return;
  current[last] = value;
}

/**
 * The three keys that turn an object write into a prototype write.
 *
 * The paths here come from `template_versions.sections`, which only an administrator can
 * write and which `P0-20` validates against the canonical field registry — so this is
 * defence behind two other controls rather than the only one. It is three lines.
 */
function isUnsafeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}
