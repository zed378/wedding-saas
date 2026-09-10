import { describe, it, expect } from "vitest";

import {
  validateTemplateVersion,
  assertValidTemplateVersion,
  TemplateVersionInvalidError,
  type TemplateVersionDefinition,
} from "./template-version.js";
import { COMPONENT_REGISTRY, SECTION_KEYS } from "./component-registry.js";

/**
 * P0-20 — template version validation.
 *
 * `docs/DATABASE/03` § Schema Validation requires this before a write. Every rejection
 * below describes a definition that is structurally valid JSON, stores happily in a
 * JSONB column, and renders wrongly — which is the class of bug this task exists to
 * move from production to authoring time.
 */

const VALID_THEME = {
  colors: {
    primary: "#8B5E3C",
    secondary: "#F4EDE4",
    accent: "#C9A876",
    text: "#2B2B2B",
  },
  typography: {
    heading_font: "Playfair Display",
    body_font: "Lato",
    scale: "default",
  },
  spacing: "comfortable",
  border_radius: "rounded",
};

const HERO = {
  section_key: "hero",
  component: "HeroClassic",
  enabled_by_default: true,
  configurable: false,
  required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
};

const GALLERY = {
  section_key: "gallery",
  component: "GalleryGrid",
  enabled_by_default: true,
  configurable: true,
  max_items: 20,
  required_fields: ["gallery.photos"],
  optional_fields: ["gallery.photos.*.caption"],
  layout_variant: "grid-3col",
  layout_options: ["grid-3col", "carousel"],
};

/** A definition that must always pass, so a rejection below is attributable. */
const valid = (
  overrides: Partial<TemplateVersionDefinition> = {},
): TemplateVersionDefinition => ({
  sections: [HERO, GALLERY],
  theme: VALID_THEME,
  customizable_theme_keys: ["colors.primary"],
  ...overrides,
});

/** The messages from a failed validation, joined — for `toContain` assertions. */
const messagesOf = (input: TemplateVersionDefinition): string => {
  const result = validateTemplateVersion(input);
  expect(result.ok, "expected this definition to be rejected").toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result.errors.map((e) => `${e.field}: ${e.message}`).join("\n");
};

describe("a valid definition", () => {
  it("is accepted", () => {
    const result = validateTemplateVersion(valid());
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it("defaults required_fields and optional_fields to empty arrays", () => {
    const result = validateTemplateVersion(
      valid({
        sections: [
          {
            section_key: "closing",
            component: "ClosingSimple",
            enabled_by_default: true,
            configurable: true,
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections[0]!.required_fields).toEqual([]);
    expect(result.value.sections[0]!.optional_fields).toEqual([]);
  });

  it("defaults customizable_theme_keys to empty when omitted", () => {
    const result = validateTemplateVersion({
      sections: [HERO],
      theme: VALID_THEME,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.customizable_theme_keys).toEqual([]);
  });
});

describe("field paths (DoD: an unknown path is rejected with a message naming it)", () => {
  it("rejects an unknown field path, naming it", () => {
    const messages = messagesOf(
      valid({
        sections: [{ ...HERO, required_fields: ["couple.groom.nickmame"] }],
      }),
    );
    expect(messages).toContain("couple.groom.nickmame");
    expect(messages).toContain("sections[0].required_fields[0]");
  });

  it("suggests the near miss", () => {
    const messages = messagesOf(
      valid({
        sections: [{ ...HERO, required_fields: ["couple.groom.nickmame"] }],
      }),
    );
    expect(messages).toContain("couple.groom.nickname");
  });

  it("rejects an unknown path in optional_fields too", () => {
    const messages = messagesOf(
      valid({ sections: [{ ...HERO, optional_fields: ["gallery.captions"] }] }),
    );
    expect(messages).toContain("gallery.captions");
  });

  it("rejects a prototype-pollution shaped path", () => {
    // docs/SECURITY/08. Rejected here by the registry; the resolver refuses the
    // segment independently.
    const messages = messagesOf(
      valid({
        sections: [{ ...HERO, required_fields: ["__proto__.polluted"] }],
      }),
    );
    expect(messages).toContain("__proto__.polluted");
  });

  it("rejects a path listed as both required and optional", () => {
    const messages = messagesOf(
      valid({
        sections: [
          {
            ...GALLERY,
            required_fields: ["gallery.photos"],
            optional_fields: ["gallery.photos"],
          },
        ],
      }),
    );
    expect(messages).toContain("both required and optional");
  });
});

describe("components (DoD: an unregistered component is rejected)", () => {
  it("rejects a component no renderer provides", () => {
    const messages = messagesOf(
      valid({ sections: [{ ...HERO, component: "HeroSpectacular" }] }),
    );
    expect(messages).toContain("HeroSpectacular");
    expect(messages).toContain("sections[0].component");
  });

  it("rejects a real component registered for a different section", () => {
    // Passes a name-only check and renders a hero where the gallery belongs.
    const messages = messagesOf(
      valid({ sections: [HERO, { ...GALLERY, component: "HeroClassic" }] }),
    );
    expect(messages).toContain("HeroClassic");
    expect(messages).toContain("gallery");
  });

  it("names the components that would have been valid", () => {
    const messages = messagesOf(
      valid({ sections: [HERO, { ...GALLERY, component: "HeroClassic" }] }),
    );
    expect(messages).toContain("GalleryGrid");
    expect(messages).toContain("GalleryCarousel");
  });
});

describe("section-level rules", () => {
  it("rejects an unknown section_key", () => {
    const messages = messagesOf(
      valid({ sections: [{ ...HERO, section_key: "sponsors" }] }),
    );
    expect(messages).toContain("sections[0].section_key");
  });

  it("rejects a duplicate section_key", () => {
    const messages = messagesOf(valid({ sections: [GALLERY, GALLERY] }));
    expect(messages).toContain("duplicate section_key");
    expect(messages).toContain("gallery");
  });

  it("rejects a non-configurable section that defaults to off", () => {
    const messages = messagesOf(
      valid({
        sections: [{ ...HERO, configurable: false, enabled_by_default: false }],
      }),
    );
    expect(messages).toContain("enabled_by_default");
  });

  it("rejects a default layout that is not among the options", () => {
    const messages = messagesOf(
      valid({
        sections: [
          HERO,
          {
            ...GALLERY,
            layout_variant: "masonry",
            layout_options: ["grid-3col", "carousel"],
          },
        ],
      }),
    );
    expect(messages).toContain("masonry");
  });

  it("rejects layout_options with a single entry", () => {
    const messages = messagesOf(
      valid({
        sections: [
          HERO,
          {
            ...GALLERY,
            layout_variant: "grid-3col",
            layout_options: ["grid-3col"],
          },
        ],
      }),
    );
    expect(messages).toContain("at least two");
  });

  it("rejects duplicate layout options", () => {
    const messages = messagesOf(
      valid({
        sections: [
          HERO,
          {
            ...GALLERY,
            layout_options: ["grid-3col", "grid-3col", "carousel"],
          },
        ],
      }),
    );
    expect(messages).toContain("duplicate layout option");
  });

  it("rejects a layout variant outside the safe character class", () => {
    // Reaches CSS via docs/FRONTEND/04 § Theme Application.
    const messages = messagesOf(
      valid({
        sections: [
          HERO,
          {
            ...GALLERY,
            layout_variant: "grid; background:url(//evil)",
            layout_options: ["grid; background:url(//evil)", "carousel"],
          },
        ],
      }),
    );
    expect(messages).toContain("sections[1].layout_variant");
  });

  it("rejects max_items below one", () => {
    const messages = messagesOf(
      valid({ sections: [HERO, { ...GALLERY, max_items: 0 }] }),
    );
    expect(messages).toContain("sections[1].max_items");
  });

  it("rejects an unknown property rather than ignoring it", () => {
    // A typo in a key name would otherwise be stored and silently do nothing.
    const messages = messagesOf(
      valid({ sections: [{ ...HERO, enabled_by_defualt: true }] }),
    );
    expect(messages).toContain("sections[0]");
  });

  it("rejects an empty sections array", () => {
    const messages = messagesOf(valid({ sections: [] }));
    expect(messages).toContain("at least one section");
  });
});

describe("theme", () => {
  it("rejects a missing colour key", () => {
    const { accent: _accent, ...colors } = VALID_THEME.colors;
    const messages = messagesOf(valid({ theme: { ...VALID_THEME, colors } }));
    expect(messages).toContain("theme.colors.accent");
  });

  it("rejects a malformed hex colour", () => {
    const messages = messagesOf(
      valid({
        theme: {
          ...VALID_THEME,
          colors: { ...VALID_THEME.colors, primary: "brown" },
        },
      }),
    );
    expect(messages).toContain("theme.colors.primary");
  });

  it("accepts three-digit hex", () => {
    const result = validateTemplateVersion(
      valid({
        theme: {
          ...VALID_THEME,
          colors: { ...VALID_THEME.colors, primary: "#8B5" },
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown spacing value", () => {
    const messages = messagesOf(
      valid({ theme: { ...VALID_THEME, spacing: "airy" } }),
    );
    expect(messages).toContain("theme.spacing");
  });

  it("rejects an unknown border_radius value", () => {
    const messages = messagesOf(
      valid({ theme: { ...VALID_THEME, border_radius: "squircle" } }),
    );
    expect(messages).toContain("theme.border_radius");
  });

  it("rejects a font name carrying a CSS payload", () => {
    const messages = messagesOf(
      valid({
        theme: {
          ...VALID_THEME,
          typography: {
            ...VALID_THEME.typography,
            heading_font: "Lato; color:red",
          },
        },
      }),
    );
    expect(messages).toContain("theme.typography.heading_font");
  });
});

describe("customizable_theme_keys", () => {
  it("accepts a key that resolves to a leaf", () => {
    const result = validateTemplateVersion(
      valid({ customizable_theme_keys: ["colors.primary", "spacing"] }),
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it("rejects a key that does not resolve", () => {
    // The editor would show a control that changes nothing.
    const messages = messagesOf(
      valid({ customizable_theme_keys: ["colors.tertiary"] }),
    );
    expect(messages).toContain("colors.tertiary");
    expect(messages).toContain("customizable_theme_keys[0]");
  });

  it("rejects a key naming a whole group rather than a leaf", () => {
    // Allowing `colors` would let a theme override replace the entire object,
    // including keys the template never meant to expose.
    const messages = messagesOf(valid({ customizable_theme_keys: ["colors"] }));
    expect(messages).toContain("customizable_theme_keys[0]");
  });

  it("rejects a duplicate key", () => {
    const messages = messagesOf(
      valid({ customizable_theme_keys: ["colors.primary", "colors.primary"] }),
    );
    expect(messages).toContain("duplicate theme key");
  });

  it("rejects a key longer than the VARCHAR(60) column", () => {
    const messages = messagesOf(
      valid({ customizable_theme_keys: [`colors.${"a".repeat(60)}`] }),
    );
    expect(messages).toContain("customizable_theme_keys[0]");
  });
});

describe("error reporting", () => {
  it("reports every problem at once, not just the first", () => {
    // An admin fixing one rejection per round trip is the reason validators get
    // bypassed — the same reasoning as P0-04's env schema.
    //
    // The theme is deliberately VALID here. An invalid theme suppresses the
    // customizable_theme_keys checks by design (next test), so mixing the two would
    // make this test assert the opposite of that one.
    const result = validateTemplateVersion({
      sections: [{ ...HERO, component: "Nope", required_fields: ["bad.path"] }],
      theme: VALID_THEME,
      customizable_theme_keys: ["colors.tertiary"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("sections[0].component");
    expect(fields).toContain("sections[0].required_fields[0]");
    expect(fields).toContain("customizable_theme_keys[0]");
  });

  it("reports section and theme problems together", () => {
    // The other half of "at once": the three columns are validated independently, so a
    // bad section does not hide a bad theme.
    const result = validateTemplateVersion({
      sections: [{ ...HERO, component: "Nope" }],
      theme: { ...VALID_THEME, spacing: "airy" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("sections[0].component");
    expect(fields).toContain("theme.spacing");
  });

  it("does not report every theme key as unresolvable when the theme itself is invalid", () => {
    // Otherwise one bad colour buries its own cause under a list of key errors.
    const result = validateTemplateVersion(
      valid({
        theme: { nonsense: true },
        customizable_theme_keys: ["colors.primary"],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.filter((e) =>
        e.field.startsWith("customizable_theme_keys"),
      ),
    ).toEqual([]);
  });

  it("uses pointers a frontend can display", () => {
    const messages = messagesOf(
      valid({ sections: [HERO, { ...GALLERY, required_fields: ["nope"] }] }),
    );
    expect(messages).toContain("sections[1].required_fields[0]");
  });
});

describe("assertValidTemplateVersion", () => {
  it("returns the parsed value for a valid definition", () => {
    expect(assertValidTemplateVersion(valid()).sections).toHaveLength(2);
  });

  it("throws with every detail attached", () => {
    let thrown: unknown;
    try {
      assertValidTemplateVersion(
        valid({ sections: [{ ...HERO, component: "Nope" }] }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TemplateVersionInvalidError);
    expect(
      (thrown as TemplateVersionInvalidError).details.length,
    ).toBeGreaterThan(0);
    expect((thrown as Error).message).toContain("Nope");
  });
});

describe("the registries themselves", () => {
  it("binds every component to a known section key", () => {
    for (const [name, section] of Object.entries(COMPONENT_REGISTRY)) {
      expect(SECTION_KEYS, name).toContain(section);
    }
  });

  it("provides at least one component for every section key", () => {
    // A section key with no component is a key no template can ever legally use.
    const covered = new Set(Object.values(COMPONENT_REGISTRY));
    expect([...SECTION_KEYS].filter((k) => !covered.has(k))).toEqual([]);
  });
});
