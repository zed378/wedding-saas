import { describe, expect, it } from "vitest";

import {
  MINIMAL_RICH_TAGS,
  sanitize,
  sanitizeFields,
  sanitizePlainText,
  sanitizeRichText,
} from "../src/shared/sanitizer/sanitize";
import {
  NOT_USER_TEXT,
  TEXT_FIELDS,
  isKnownField,
} from "../src/shared/sanitizer/registry";

/**
 * P1-16 — the sanitizer.
 *
 * ## The payload set
 *
 * `XSS_PAYLOADS` is the set Phase 6's XSS sweep will reuse, per the card's step 6. It is
 * deliberately not a list of `<script>` variants: the payloads that get through allowlist
 * mistakes are attribute-based (`onerror`, `onload`), protocol-based (`javascript:`), or
 * parser-confusion (SVG, MathML, mutation XSS). A test suite of ten `<script>` spellings
 * would pass against a blacklist that is trivially bypassable.
 */

const XSS_PAYLOADS: readonly [string, string][] = [
  ["a bare script tag", "<script>alert(1)</script>"],
  [
    "a script with attributes",
    '<script type="text/javascript">alert(1)</script>',
  ],
  ["an image error handler", '<img src=x onerror="alert(1)">'],
  ["an svg onload", "<svg/onload=alert(1)>"],
  ["a body onload", "<body onload=alert(1)>"],
  ["a javascript: link", '<a href="javascript:alert(1)">click</a>'],
  [
    "a data: URI link",
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  ],
  ["an iframe", '<iframe src="https://evil.test"></iframe>'],
  ["an object tag", '<object data="evil.swf"></object>'],
  [
    "a style block",
    "<style>body{background:url('javascript:alert(1)')}</style>",
  ],
  [
    "an inline style with expression",
    '<div style="width:expression(alert(1))">x</div>',
  ],
  [
    "a mutation-xss shape",
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  ],
  [
    "a math/mtext payload",
    "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
  ],
  ["an unclosed tag", "<script>alert(1)"],
  ["a malformed tag", "<<script>alert(1);//<</script>"],
  ["an uppercase tag", "<SCRIPT>alert(1)</SCRIPT>"],
  // Written with escape sequences rather than the bytes themselves: a source file
  // containing a real NUL is one git classifies as BINARY and stops diffing
  // (`scripts/check-text-sources.mjs`). The value under test is identical.
  ["a null-byte separated tag", "<scri\u0000pt>alert(1)</scri\u0000pt>"],
  ["a tab-separated handler", "<img src=x\tonerror=alert(1)>"],
  ["a newline-separated handler", "<img src=x\nonerror=alert(1)>"],
  ["a form action", '<form action="javascript:alert(1)"><input type=submit>'],
  [
    "a meta refresh",
    '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  ],
  ["a base tag", '<base href="https://evil.test/">'],
  ["an embedded event on a permitted tag", '<b onclick="alert(1)">Budi</b>'],
];

/** What must never survive, in any output, for any field. */
const FORBIDDEN = [
  /<script/i,
  /<iframe/i,
  /<object/i,
  /<embed/i,
  /<style/i,
  /<meta/i,
  /<base/i,
  /<form/i,
  /<svg/i,
  /<img/i,
  /\son\w+\s*=/i,
  /javascript:/i,
];

function assertInert(output: string, label: string): void {
  for (const pattern of FORBIDDEN) {
    expect(
      pattern.test(output),
      `${label} left something live: ${pattern} matched ${JSON.stringify(output)}`,
    ).toBe(false);
  }
}

describe("plain text (the default for every registered field)", () => {
  it.each(XSS_PAYLOADS)("neutralises %s", (_name, payload) => {
    assertInert(sanitizePlainText(payload), "sanitizePlainText");
  });

  it("keeps ordinary text intact", () => {
    // The failure mode nobody tests for: a sanitizer that mangles real names. Indonesian
    // names carry apostrophes and hyphens, and a wedding invitation is full of both.
    expect(sanitizePlainText("Budi Santoso")).toBe("Budi Santoso");
    expect(sanitizePlainText("Nur'aini Putri-Wijaya")).toBe(
      "Nur'aini Putri-Wijaya",
    );
    expect(sanitizePlainText("Jl. Merdeka No. 17, RT 03/RW 05")).toBe(
      "Jl. Merdeka No. 17, RT 03/RW 05",
    );
  });

  it("keeps non-ascii intact", () => {
    expect(sanitizePlainText("Ani & Budi — 💐")).toContain("💐");
    expect(sanitizePlainText("إنشاء الله")).toBe("إنشاء الله");
  });

  it("strips tags but keeps their text", () => {
    // `<b>Budi</b>` is somebody typing markup into a name field, not an attack. Keeping
    // the text is the friendly outcome; keeping the tag is not.
    expect(sanitizePlainText("<b>Budi</b> Santoso")).toBe("Budi Santoso");
  });

  it("discards the CONTENT of a script, rather than exposing it as text", () => {
    // A sanitizer that only removed tags would store `alert(1)` as somebody's name --
    // harmless, and a baffling thing to find in a database.
    expect(sanitizePlainText("<script>alert(1)</script>")).toBe("");
  });

  it("stores TEXT, not HTML — an ampersand is not encoded", () => {
    // A real defect, caught by a test asserting what reached the service. `sanitize-html`
    // emits HTML, so `Budi & Ani` came back as `Budi &amp; Ani`; storing that is wrong,
    // because a correct renderer escapes again and the user sees `Budi &amp; Ani`.
    expect(sanitizePlainText("Budi & Ani")).toBe("Budi & Ani");
    expect(sanitizePlainText("Tanya & Co. <Jakarta>")).not.toContain("&amp;");
    expect(sanitizePlainText('He said "yes"')).toBe('He said "yes"');
    expect(sanitizePlainText("Nur'aini")).toBe("Nur'aini");
  });

  it("an entity-encoded tag is decoded and then discarded, at any depth", () => {
    // Decoding once is not safe: `&amp;lt;script&amp;gt;` decodes to `&lt;script&gt;`,
    // which decodes to `<script>`. The attacker picks the depth, so the sanitizer loops
    // to a fixed point and re-strips what each layer reveals.
    for (const payload of [
      "&lt;script&gt;alert(1)&lt;/script&gt;",
      "&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;",
      "&amp;amp;lt;script&amp;amp;gt;alert(1)",
      "&#60;script&#62;alert(1)&#60;/script&#62;",
      "&#x3c;script&#x3e;alert(1)",
    ]) {
      const once = sanitizePlainText(payload);
      assertInert(once, `single pass on ${payload}`);
      assertInert(sanitizePlainText(once), `double pass on ${payload}`);
      expect(sanitizePlainText(once), payload).toBe(once);
    }
  });

  it("a lone angle bracket that is not a tag survives as text", () => {
    // The other side of the same coin: `1 < 2` must not be eaten as a broken tag, and
    // must not come back encoded either.
    expect(sanitizePlainText("1 < 2 and 3 > 2")).toBe("1 < 2 and 3 > 2");
  });

  it("is idempotent for every payload", () => {
    // Sanitized content is re-sanitized on any later edit. If a second pass could change
    // the result, a stored value could decay into something live.
    for (const [, payload] of XSS_PAYLOADS) {
      const once = sanitizePlainText(payload);
      expect(sanitizePlainText(once)).toBe(once);
    }
  });

  it("trims", () => {
    expect(sanitizePlainText("  Budi  ")).toBe("Budi");
  });

  it("handles an empty string and whitespace", () => {
    expect(sanitizePlainText("")).toBe("");
    expect(sanitizePlainText("   ")).toBe("");
  });
});

describe("rich text (nothing uses it yet)", () => {
  it.each(XSS_PAYLOADS)("neutralises %s", (_name, payload) => {
    assertInert(sanitizeRichText(payload), "sanitizeRichText");
  });

  it("keeps the six permitted tags", () => {
    expect(sanitizeRichText("<b>Budi</b> and <em>Ani</em>")).toBe(
      "<b>Budi</b> and <em>Ani</em>",
    );
  });

  it("strips every attribute, even from a permitted tag", () => {
    // An allowlist of tags with a free-for-all on attributes is not an allowlist. Almost
    // every DOM-XSS payload is an attribute.
    expect(sanitizeRichText('<b onclick="alert(1)" class="x">Budi</b>')).toBe(
      "<b>Budi</b>",
    );
  });

  it("permits no tag that can navigate or load", () => {
    // Asserted against the constant rather than by example, so adding a tag to the
    // allowlist has to pass this.
    for (const tag of MINIMAL_RICH_TAGS) {
      expect(["a", "img", "iframe", "script", "link", "form"]).not.toContain(
        tag,
      );
    }
  });
});

describe("the registry (step 3)", () => {
  it("covers every field the card names", () => {
    // The card's own list: "person names, parent names, child order, event
    // title/venue/address/description, gallery caption, bank provider/holder, quote text
    // and source, RSVP guest name and message, guestbook name and message, invitation
    // internal name, user full name."
    for (const field of [
      "full_name",
      "nickname",
      "father_name",
      "mother_name",
      "child_order",
      "title",
      "venue_name",
      "address",
      "description",
      "caption",
      "provider_name",
      "account_holder",
      "text",
      "source",
      "guest_name",
      "message",
      "internal_name",
    ]) {
      expect(TEXT_FIELDS[field], `${field} is not registered`).toBeDefined();
    }
  });

  it("every registered field neutralises every payload", () => {
    // The parameterised test the DoD asks for, over the registry rather than over a list
    // somebody typed twice.
    for (const [field, mode] of Object.entries(TEXT_FIELDS)) {
      for (const [name, payload] of XSS_PAYLOADS) {
        assertInert(sanitize(payload, mode), `${field} / ${name}`);
      }
    }
  });

  it("no field is in both lists", () => {
    // One would silently win, and which one would depend on the order of two `in` checks
    // in a helper nobody reads.
    for (const field of Object.keys(TEXT_FIELDS)) {
      expect(NOT_USER_TEXT[field], `${field} is in both lists`).toBeUndefined();
    }
  });

  it("every exemption carries a reason", () => {
    // The line a reviewer is supposed to disbelieve. An empty one is an exemption nobody
    // has to defend.
    for (const [field, reason] of Object.entries(NOT_USER_TEXT)) {
      expect(reason.length, `${field} has no reason`).toBeGreaterThan(10);
    }
  });

  it("no credential is registered as text", () => {
    // Sanitizing a password would silently change the secret.
    for (const field of ["password", "new_password", "old_password", "token"]) {
      expect(TEXT_FIELDS[field]).toBeUndefined();
      expect(NOT_USER_TEXT[field]).toBeDefined();
    }
  });

  it("isKnownField answers for both lists and nothing else", () => {
    expect(isKnownField("full_name")).toBe(true);
    expect(isKnownField("password")).toBe(true);
    expect(isKnownField("wedding_hashtag")).toBe(false);
  });
});

describe("sanitizeFields", () => {
  it("sanitizes only registered keys that are present", () => {
    const out = sanitizeFields(
      { full_name: "<b>Budi</b>", untouched: "<b>keep</b>" },
      TEXT_FIELDS,
    );

    expect(out.full_name).toBe("Budi");
    // Not in the registry, so not this function's business -- the CI check is what makes
    // sure such a field does not exist in a request schema.
    expect(out.untouched).toBe("<b>keep</b>");
  });

  it("does not add keys that were absent", () => {
    // A partial PATCH body must not gain keys: `undefined` and "absent" mean different
    // things to every update path in this codebase.
    const out = sanitizeFields({ full_name: "Budi" }, TEXT_FIELDS);
    expect(Object.keys(out)).toEqual(["full_name"]);
  });

  it("leaves non-strings alone", () => {
    const out = sanitizeFields(
      { title: 42 as unknown as string, description: null },
      TEXT_FIELDS,
    );
    expect(out.title).toBe(42);
    expect(out.description).toBeNull();
  });

  it("does not mutate its input", () => {
    const input = { full_name: "<b>Budi</b>" };
    sanitizeFields(input, TEXT_FIELDS);
    expect(input.full_name).toBe("<b>Budi</b>");
  });
});

describe("no blacklist anywhere (the DoD's third item)", () => {
  it("an unknown tag is removed without being listed", () => {
    // The property that distinguishes an allowlist: a tag nobody anticipated is gone
    // because it is not permitted, not because somebody remembered to forbid it.
    expect(sanitizePlainText("<xyzzy>Budi</xyzzy>")).toBe("Budi");
    expect(sanitizeRichText("<xyzzy>Budi</xyzzy>")).toBe("Budi");
    expect(sanitizeRichText("<custom-element>Budi</custom-element>")).toBe(
      "Budi",
    );
  });

  it("an unknown attribute is removed from a permitted tag", () => {
    expect(sanitizeRichText('<b data-anything="x" xyzzy="y">Budi</b>')).toBe(
      "<b>Budi</b>",
    );
  });
});
