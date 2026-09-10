import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * P0-21 — reading the seed data files.
 *
 * One loader, used by the seed command and by the test that validates the reference
 * template against `P0-20`'s schema. Two readers of the same bytes is the point: a test
 * that parsed its own copy would pass while the seed wrote something else.
 *
 * ## Why the files carry `_`-prefixed keys
 *
 * JSON has no comments, and the reference template is a document whose *reasoning*
 * matters as much as its values — why the gift section defaults to off, why parents are
 * optional, why `max_items` is 20 and not the package's 200. That reasoning has to live
 * beside the value it explains or it stops being read.
 *
 * The alternatives were worse. JSON5 means a parser dependency for a comment. A sidecar
 * markdown file drifts from the data the first time someone edits one and not the other.
 * A `.ts` file would put the template in code, which is the one thing `docs/PLAN/07`
 * § Core Principles forbids.
 *
 * So: any key starting with `_` is annotation and is stripped before validation. The
 * cost is real and worth naming — `sectionSchema` is `.strict()` precisely so a typo in
 * a key name is rejected rather than ignored, and this convention creates one shape of
 * typo (`_section_key`) that is silently dropped instead. The leading underscore has to
 * be deliberate, which is what makes that acceptable.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Recursively drop `_`-prefixed keys. Arrays and scalars pass through unchanged. */
export function stripAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAnnotations);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !key.startsWith("_"))
      .map(([key, v]) => [key, stripAnnotations(v)]),
  );
}

function load(name: string): Record<string, unknown> {
  const raw = readFileSync(join(HERE, name), "utf8");
  return stripAnnotations(JSON.parse(raw)) as Record<string, unknown>;
}

/** The reference template, annotations stripped. `reference-template.json`. */
export function loadReferenceTemplate(): ReferenceTemplateFile {
  return load("reference-template.json") as unknown as ReferenceTemplateFile;
}

/** The demo invitation's content, annotations stripped. `demo-invitation.json`. */
export function loadDemoInvitation(): DemoInvitationFile {
  return load("demo-invitation.json") as unknown as DemoInvitationFile;
}

export interface ReferenceTemplateFile {
  readonly template: {
    readonly slug: string;
    readonly name: string;
    readonly category: readonly string[];
    readonly is_premium: boolean;
    readonly status: string;
  };
  readonly version: string;
  readonly status: string;
  readonly changelog: string;
  readonly sections: readonly unknown[];
  readonly theme: unknown;
  readonly customizable_theme_keys: readonly string[];
}

export interface DemoInvitationFile {
  readonly internal_name: string;
  readonly people: readonly Record<string, unknown>[];
  readonly events: readonly Record<string, unknown>[];
  readonly quote: { readonly text: string; readonly source: string };
  readonly gift_accounts: readonly Record<string, unknown>[];
  readonly gallery: readonly {
    readonly caption: string | null;
    readonly is_cover: boolean;
    readonly display_order: number;
  }[];
  readonly settings: {
    readonly enabled_sections: readonly string[];
    readonly rsvp_enabled: boolean;
    readonly guestbook_enabled: boolean;
    readonly guestbook_moderation: boolean;
    readonly seo_indexable: boolean;
  };
  readonly guestbook: readonly Record<string, unknown>[];
  readonly guests: readonly Record<string, unknown>[];
}
