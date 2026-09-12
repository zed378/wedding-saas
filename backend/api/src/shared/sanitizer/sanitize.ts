import sanitizeHtml from "sanitize-html";

/**
 * P1-16 — the one sanitization step. `docs/SECURITY/08` § Output Encoding,
 * `docs/BACKEND/03` § Free-Text Input Sanitization.
 *
 * ## Why this is a task and not three lines in a controller
 *
 * Every free-text field in this product renders on a public page seen by hundreds of
 * guests. `docs/SECURITY/08` calls stored XSS "a primary risk" here, and the shape of that
 * risk is specific: a couple types their own name, and three hundred people load it.
 *
 * Implemented per-endpoint, it gets forgotten on the fifth endpoint. Implemented as a
 * step with a registry, forgetting requires deleting something — and
 * `scripts/check-sanitized-fields.mjs` fails the build when a new text field appears that
 * is in neither the registry nor the exemption list.
 *
 * ## Allowlist, never blacklist
 *
 * `docs/SECURITY/08`: "use a whitelist-based sanitizer with a very limited allowed tag
 * list ..., not a blacklist". A blacklist is a list of the attacks somebody thought of;
 * `<svg/onload=…>`, `<math><mtext><table><mglyph><style>` and a dozen mutation-XSS
 * payloads are what it misses.
 *
 * **Almost every field here allows no tags at all**, which is the strictest possible
 * allowlist rather than an exception to the rule. A wedding guest's name is text. The
 * question "which tags should a venue address support" has the answer "none", and
 * answering it that way is not a shortcut.
 *
 * ## Why `sanitize-html` and not DOMPurify
 *
 * `docs/SECURITY/08` names DOMPurify as an example. DOMPurify parses with a real DOM,
 * which on the server means jsdom — a large dependency whose own HTML parser then becomes
 * part of the security boundary. `sanitize-html` uses `htmlparser2` and is built for this
 * exact job server-side. The document says "e.g.", and the allowlist property it actually
 * requires is what both provide.
 */

/**
 * The entities `sanitize-html` emits, and the ones a browser would decode.
 *
 * Deliberately short. This is not a general HTML entity table: it is the set needed to
 * undo `sanitize-html`'s own output encoding, plus the numeric forms of the same
 * characters, because those are what an attacker uses to re-encode a payload.
 */
const ENTITIES: readonly [RegExp, string][] = [
  [/&lt;|&#0*60;|&#x0*3c;/gi, "<"],
  [/&gt;|&#0*62;|&#x0*3e;/gi, ">"],
  [/&quot;|&#0*34;|&#x0*22;/gi, '"'],
  [/&#0*39;|&#x0*27;|&apos;/gi, "'"],
  // LAST. Decoding `&amp;` first would turn `&amp;lt;` into `&lt;` and then into `<`
  // within a single pass, which is the collapse this order avoids doing accidentally --
  // the loop below does it deliberately and checks the result each time.
  [/&amp;|&#0*38;|&#x0*26;/gi, "&"],
];

function decodeEntities(value: string): string {
  let out = value;
  for (const [pattern, char] of ENTITIES) out = out.replace(pattern, char);
  return out;
}

/**
 * Strip every tag, and store plain text rather than HTML.
 *
 * ## Why this loops
 *
 * `sanitize-html` produces HTML: it strips tags and then **encodes** what remains, so
 * `Budi & Ani` comes back as `Budi &amp; Ani`. Storing that is wrong — the value is a
 * name, not markup, and a correct renderer would escape it again and display
 * `Budi &amp; Ani` to the user. This was a real defect, caught by a test asserting what
 * reached the service.
 *
 * So the encoding has to be undone. But decoding once is not enough and is not safe:
 * `&amp;lt;script&amp;gt;` decodes to `&lt;script&gt;`, which decodes to `<script>`. An
 * attacker controls how many layers they apply.
 *
 * The loop strips, decodes, and repeats until the value stops changing. Each pass removes
 * one layer of encoding **and** re-strips whatever that layer revealed, so the fixed point
 * it converges to contains no tag at any depth of encoding. The final strip is what
 * guarantees the last decode did not expose one.
 *
 * ## What this means for a user who types `&lt;script&gt;`
 *
 * They get nothing back. Those characters decode to a tag, and the tag is discarded —
 * the same outcome as typing the tag directly. That is heavier-handed than preserving
 * their literal keystrokes, and it is the right trade for a field whose content is loaded
 * by hundreds of guests: `docs/SECURITY/08` makes stored XSS the primary risk, and the
 * server-side step exists precisely so the renderer is not the only thing standing there.
 */
const MAX_PASSES = 5;

export function sanitizePlainText(value: string): string {
  let current = value;

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const stripped = sanitizeHtml(current, {
      allowedTags: [],
      allowedAttributes: {},
      // The CONTENT of a <script> is discarded rather than turned into visible text.
      // Without this, `<script>alert(1)</script>` would sanitise to the string `alert(1)`
      // -- harmless, but a baffling thing to store as somebody's name.
      disallowedTagsMode: "discard",
    });

    const next = decodeEntities(stripped);
    if (next === current) return current.trim();
    current = next;
  }

  // Five layers of encoding is not a name. Strip once more and keep whatever text is
  // left; returning the input unchanged here would be the one branch that skips the
  // sanitizer entirely.
  return sanitizeHtml(current, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: "discard",
  }).trim();
}

/**
 * The minimal rich-text allowlist. **Nothing uses this yet.**
 *
 * It exists so that when a field genuinely needs formatting — a quote with emphasis, say —
 * the answer is already written down rather than invented under pressure. Six inline tags,
 * no attributes at all, and therefore no `href`, no `style`, no `class`, and nothing that
 * can carry `javascript:`.
 *
 * Adding a tag here is a security decision. Adding an *attribute* is a larger one: almost
 * every DOM-XSS payload is an attribute.
 */
export const MINIMAL_RICH_TAGS = ["b", "strong", "i", "em", "br", "p"] as const;

export function sanitizeRichText(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: [...MINIMAL_RICH_TAGS],
    // Empty, deliberately. An allowlist of tags with a free-for-all on attributes is not
    // an allowlist.
    allowedAttributes: {},
    disallowedTagsMode: "discard",
  }).trim();
}

/** How a registered field is treated. */
export type SanitizationMode = "plain" | "rich";

export function sanitize(value: string, mode: SanitizationMode): string {
  return mode === "rich" ? sanitizeRichText(value) : sanitizePlainText(value);
}

/**
 * Sanitize the registered text fields of an object, in place of the caller remembering to.
 *
 * Only keys present in `fields` are touched, and only when their value is a string — a
 * partial `PATCH` body must not gain keys it did not have, because `undefined` and
 * `"absent"` mean different things to every update path in this codebase.
 */
export function sanitizeFields<T extends Record<string, unknown>>(
  input: T,
  fields: Readonly<Record<string, SanitizationMode>>,
): T {
  const output: Record<string, unknown> = { ...input };

  for (const [key, mode] of Object.entries(fields)) {
    const value = output[key];
    if (typeof value === "string") {
      output[key] = sanitize(value, mode);
    }
  }

  return output as T;
}
