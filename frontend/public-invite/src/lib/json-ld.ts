/**
 * `P2-09` — JSON-LD as a string a browser cannot be tricked into leaving early.
 *
 * An invitation's venue name and event title are user text. They are sanitized on the way
 * in (`P1-16`), but not against this context: inside a `<script>` element a `<` is not
 * markup and the one sequence that ends the element is `</script`. A venue called
 * `</script><img onerror=…>` would otherwise close the element and run.
 *
 * Replacing every `<` with its JSON unicode escape leaves the value byte-identical to a
 * JSON parser — `<` *is* `<` — and makes the element impossible to close early.
 *
 * Its own module so it can be unit tested without a server component around it, and so
 * the next person who needs to emit JSON-LD finds it rather than writing the line again.
 */
export function safeJsonLd(value: Record<string, unknown>): string {
  // `replaceAll` with two plain strings, not a regex: a regex replacement treats `$` and
  // a backslash specially, and the replacement here has to be the six literal characters
  // of an escape sequence.
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
