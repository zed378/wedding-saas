/**
 * `P2-10` step 2 — the `?to=` guest name, cleaned.
 *
 * `docs/UI-UX/14` § Key Interactions: *"Guest name personalization (`?to=Name`): displayed
 * on the Cover … rendered client-side from the query param, does NOT affect server-side
 * caching of the main page"*.
 *
 * ## This is attacker-controlled text in a URL people forward
 *
 * That sentence is the whole reason this is a module with tests rather than three lines in
 * a component. The value arrives in a link, and the link gets forwarded — so whatever it
 * contains ends up on a wedding page in front of several hundred people who trust the
 * couple who sent it. Someone can craft `?to=` with markup, with a thousand characters,
 * with right-to-left override characters that reverse the text after them, or with a
 * newline-filled string that pushes the invitation off the screen.
 *
 * React escapes text on render, so markup cannot become HTML — that is a property of the
 * renderer, not of this function, and `guest-name.spec.ts` asserts it anyway because it is
 * the thing that would matter most if it ever changed.
 *
 * What this function does is the part React does *not* do: refuse the shapes that are
 * still harmful as plain text.
 */

/** `docs/UI-UX/14` shows a name, not a sentence. Long enough for "Bapak Haji Ahmad Sudirman". */
const MAX_LENGTH = 60;

/**
 * Characters that are invisible, or that reorder what follows them.
 *
 * The bidirectional overrides are the interesting ones. `U+202E` flips the direction of
 * everything after it, so a crafted `?to=` can make the surrounding text read backwards —
 * a defacement that survives HTML escaping completely, because nothing about it is markup.
 *
 * Written as explicit escapes rather than literal characters: a range of invisible
 * codepoints pasted into a source file is unreviewable, and `check-text-sources.mjs` would
 * reject the control characters among them anyway.
 */
const INVISIBLE_OR_REORDERING = new RegExp(
  "[" +
    // C0 controls, but NOT U+0009 to U+000D. Those are whitespace, and the collapse
    // below turns them into a single space; deleting them instead joins the words either
    // side — an encoded newline made "Andi Pratama" into "AndiPratama". A test caught it.
    "\\u0000-\\u0008\\u000E-\\u001F" +
    "\\u007F-\\u009F" + // DEL and the C1 controls
    "\\u200B-\\u200F" + // zero-width space through the RTL/LTR marks
    "\\u202A-\\u202E" + // the bidirectional embedding and override set
    "\\u2060-\\u2064" + // word joiner and the invisible operators
    "\\u206A-\\u206F" + // deprecated formatting characters
    "\\uFEFF" + // a zero-width no-break space, often pasted from Word
    "]",
  "g",
);

/**
 * The guest name to greet, or `undefined`.
 *
 * `undefined` for absent, empty, whitespace-only, and for anything left empty after
 * cleaning — a greeting addressed to nobody is worse than no greeting, because it looks
 * like the couple forgot to fill something in.
 */
export function readGuestName(search: string): string | undefined {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get("to");
  } catch {
    // A malformed query string is not a greeting. `URLSearchParams` is forgiving, but this
    // runs on whatever a forwarded link contains and a throw here would blank the page.
    return undefined;
  }

  if (raw === null) return undefined;

  return cleanGuestName(raw);
}

/** The cleaning half, exported so it can be tested against a value directly. */
export function cleanGuestName(raw: string): string | undefined {
  const cleaned = raw
    .replace(INVISIBLE_OR_REORDERING, "")
    // Any run of whitespace becomes one space. A name is one line.
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length === 0) return undefined;

  // Truncate rather than reject. Somebody with a genuinely long name should still be
  // greeted, and rejecting would show no greeting at all with no way to tell why.
  return cleaned.length > MAX_LENGTH
    ? `${cleaned.slice(0, MAX_LENGTH).trimEnd()}…`
    : cleaned;
}
