import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { templateVersions, templates } from "../../infra/db/schema/templates";
import { BusinessRuleError, NotFoundError } from "../../http/errors";
import {
  collectMissingRequiredFields,
  type SectionDefinition,
} from "@wi/schema";

import { logger } from "../../shared/logging/logger";
import { requireOwnership } from "../../shared/auth-middleware";
import { AuditLogService } from "../../shared/audit/audit-log.service";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { parseSections } from "./settings.service";
import { toInvitationDetail } from "./invitation.dto";
import { summarise } from "./publish-check.service";

/**
 * P1-15 — `POST /invitations/:id/change-template`. BR-3.1, BR-4.1, `docs/PLAN/07`
 * § Template Compatibility & Migration.
 *
 * ## The rule this whole file exists to keep
 *
 * **Nothing is deleted.** BR-4.1: "Sections not supported by the active template are NOT
 * displayed publicly, but the data remains stored in the database (to remain safe if the
 * user switches templates)." So "this template has no gallery" is a *rendering* decision,
 * and the couple's photos stay exactly where they were. Switch back and they are on the page
 * again.
 *
 * There is no `delete` in this file, none in `InvitationRepository.changeTemplate`, and a
 * test asserts the row count of every child table is unchanged across a round trip. The
 * absence is the feature, which is precisely why it needs a test: an absence cannot be read
 * off a diff six months from now.
 *
 * ## What does change
 *
 * Four values, and only because leaving them would be worse than moving them:
 *
 *   `template_id` and `template_version_id` — the change itself. Resolved to the target's
 *     newest **published** version (BR-3.3), once, and written as a value rather than as
 *     "latest" (BR-3.1).
 *   `enabled_sections` — recomputed. A key the new template does not define cannot render,
 *     and leaving it would make every later settings save fail `P1-14`'s validation on a
 *     value the server itself wrote.
 *   `theme_override` — keys the new template does not list as customizable are dropped, and
 *     the response says which. See `dropThemeKeys`.
 *
 * ## Why `theme_override` may be dropped when section data may not
 *
 * Because a theme override's key namespace belongs to the template. `colors.accent` means
 * whatever this template's `customizable_theme_keys` says it means; carried into a template
 * that does not offer it, it is not hidden data waiting to come back, it is a value with no
 * referent. Section *data* is the opposite: `gallery` photos are the couple's, and a template
 * is only the thing that decides whether to show them. ADR-054 records the distinction,
 * because "no data loss" and "overrides are dropped" read as a contradiction without it.
 */

export interface ChangeTemplateResult {
  readonly template_id: string;
  readonly template_version_id: string;
  readonly enabled_sections: string[];
  /** Enabled before, undefined in the new template. `docs/UI-UX/05`'s modal lists these. */
  readonly hidden_sections: string[];
  /** Removed from `theme_override` because the new template does not permit them. */
  readonly dropped_theme_keys: string[];
}

@Injectable()
export class ChangeTemplateService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repository: InvitationRepository,
    private readonly audit: AuditLogService,
  ) {}

  async change(
    scope: TenantScope,
    invitationId: string,
    templateId: string,
  ): Promise<ChangeTemplateResult> {
    const invitation = await requireOwnership(
      () => this.repository.findOwned(invitationId, scope),
      { scope, resourceType: "invitation", resourceId: invitationId },
    );

    // Ownership is proven before the template id is looked at. That order is what stops
    // this endpoint being a way to ask "does this template exist?" — a caller who does not
    // own the invitation gets a 404 either way.
    if (invitation.templateId === templateId) {
      throw new BusinessRuleError(
        "TEMPLATE_UNCHANGED",
        "Undangan ini sudah menggunakan template tersebut.",
      );
    }

    const target = await this.resolvePublishedVersion(templateId);

    // The invitation's CURRENT version, read through the invitation so it is scoped. Its
    // `sections` are needed to tell "the user turned this off" from "the user never had it".
    const current = await this.repository.findTemplateVersionFor(
      invitationId,
      scope,
    );
    if (current === null) throw new NotFoundError();

    const settings = await this.repository.findOwnedSettings(
      invitationId,
      scope,
    );

    const previous = settings?.enabledSections ?? [];
    const { enabled, hidden } = recomputeSections(
      current.sections,
      target.sections,
      previous,
    );

    const { kept, dropped } = dropThemeKeys(
      (settings?.themeOverride ?? {}) as Record<string, unknown>,
      target.customizableThemeKeys,
    );

    /**
     * OQ-23, answered by ADR-061 — a **published** invitation may change template, and
     * the publish check re-runs before it does.
     *
     * The question was raised by `P1-15` and deferred for a concrete reason: the correct
     * answer made `P1-15` depend on `P2-06`, which did not exist. It does now, so the
     * objection is gone rather than overruled.
     *
     * What this prevents: a live page, several hundred guests holding the link, moved
     * onto a template that requires a field the couple never filled. BR-4.2 says required
     * fields must not be empty when publishing, and without this the invitation would be
     * published *and* incomplete — a state no endpoint could have produced directly.
     *
     * A **draft** is not checked. A draft is expected to be incomplete; that is what
     * drafts are, and `POST /publish` is where BR-4.2 applies to it.
     */
    if (invitation.status === "published") {
      const aggregate = await this.repository.loadAggregate(
        invitationId,
        scope,
      );
      const detail = toInvitationDetail(invitation, aggregate, {
        slug: "",
        name: "",
        version: "",
      });

      const missing = collectMissingRequiredFields(
        target.sections as readonly SectionDefinition[],
        enabled,
        detail,
      );

      if (missing.length > 0) {
        // 422 with the same `details[]` the publish check and the publish 422 use, so the
        // editor renders one list however it arrived.
        throw new BusinessRuleError(
          "TEMPLATE_WOULD_LEAVE_PUBLISHED_INVITATION_INCOMPLETE",
          "Template ini membutuhkan isian yang belum lengkap. Lengkapi dulu sebelum mengganti template pada undangan yang sudah tayang.",
          summarise(missing).details,
        );
      }
    }

    const moved = await this.repository.changeTemplate(
      invitationId,
      scope,
      {
        templateId,
        templateVersionId: target.id,
        enabledSections: enabled,
        themeOverride: kept,
      },
      (tx) =>
        this.audit.record(tx, {
          // The acting user. `docs/DATABASE/10` names the column `admin_id`; ADR-053
          // amended the document to say it holds whoever acted, and this is an owner
          // action on their own invitation.
          adminId: scope,
          action: "invitation.change_template",
          resourceType: "invitation",
          resourceId: invitationId,
          // The support question this trail answers is "why did my gallery disappear",
          // so the hidden keys are the part worth keeping for two years.
          reason: `template changed; sections no longer displayed: ${hidden.length > 0 ? hidden.join(", ") : "none"}`,
          beforeState: {
            template_id: invitation.templateId,
            template_version_id: invitation.templateVersionId,
            enabled_sections: [...previous],
          },
          afterState: {
            template_id: templateId,
            template_version_id: target.id,
            enabled_sections: enabled,
            dropped_theme_keys: dropped,
          },
        }),
    );

    // The load proved ownership, so a `false` here means the row moved out from under this
    // request — soft-deleted by a parallel call. Still a 404: the invitation the caller
    // asked about no longer exists.
    if (!moved) throw new NotFoundError();

    logger.info(
      {
        context: {
          invitation_id: invitationId,
          user_id: scope,
          event: "invitation.template_changed",
          from_template_version_id: invitation.templateVersionId,
          to_template_version_id: target.id,
          // Counts, not keys. A section key is not sensitive, but a count is what an
          // alert triggers on, and `P1-04` is the standing reminder that a log line is
          // somewhere data leaks to.
          hidden_section_count: hidden.length,
          dropped_theme_key_count: dropped.length,
        },
      },
      "invitation template changed",
    );

    if (invitation.status === "published") {
      // Still worth a warn line, and now for a smaller reason than before. The required
      // fields HAVE been re-checked (above, ADR-061), so the page cannot have become
      // incomplete — but its design changed under several hundred people who may have
      // the link open, and nobody confirmed anything. `docs/PLAN/02` BR-6.2 asks for a
      // confirmation on a slug change for exactly this reason; whether this deserves one
      // too is the open half of OQ-23.
      logger.warn(
        {
          context: {
            invitation_id: invitationId,
            user_id: scope,
            event: "invitation.template_changed_while_published",
          },
        },
        "template changed on a published invitation; the design changed for guests who already hold the link",
      );
    }

    return {
      template_id: templateId,
      template_version_id: target.id,
      enabled_sections: enabled,
      hidden_sections: hidden,
      dropped_theme_keys: dropped,
    };
  }

  /**
   * The target template's newest published version.
   *
   * The same query `P1-09` runs at creation, and for the same reason: BR-3.3 says a
   * deprecated or draft version "no longer appears in the catalog for new invitations", so
   * it cannot be a *destination* either. An invitation already sitting on one is untouched —
   * this method is never asked about the version the invitation currently has.
   *
   * 404 for an unknown template, not a validation error: from the caller's side an id that
   * never existed and one they may not see are the same thing.
   */
  private async resolvePublishedVersion(templateId: string): Promise<{
    id: string;
    sections: unknown;
    customizableThemeKeys: string[];
  }> {
    const [template] = await this.db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.id, templateId))
      .limit(1);

    if (template === undefined) throw new NotFoundError();

    const [version] = await this.db
      .select({
        id: templateVersions.id,
        sections: templateVersions.sections,
        customizableThemeKeys: templateVersions.customizableThemeKeys,
      })
      .from(templateVersions)
      .where(
        and(
          eq(templateVersions.templateId, templateId),
          eq(templateVersions.status, "published"),
        ),
      )
      .orderBy(desc(templateVersions.createdAt))
      .limit(1);

    if (version === undefined) {
      throw new BusinessRuleError(
        "TEMPLATE_NOT_AVAILABLE",
        "Template ini belum tersedia untuk undangan baru.",
      );
    }

    return version;
  }
}

/**
 * The new section selection, and what stops being displayed.
 *
 * `docs/PLAN/07` § Template Compatibility gives the matching rule — `section_key` equality —
 * and the card gives the formula:
 *
 *   keep what was enabled and the new template still defines,
 *   add the new template's `enabled_by_default` sections **the old template did not have**.
 *
 * The second clause says "did not have", not "was not enabled". A section the old template
 * offered and the user deliberately switched off must stay off; only a section that is new
 * to this user arrives in its template's default state. Those two readings differ on exactly
 * the case a user notices: turning the gallery off, changing template, and finding it back.
 *
 * **A non-configurable section of the new template is forced on regardless.** `P1-14` refuses
 * to let anyone disable one, so a recomputed selection that omitted one would be a state the
 * API cannot produce and cannot repair: every later settings save would 422 with
 * `SECTION_NOT_CONFIGURABLE` on a value this function wrote. It also renders an invitation
 * with no hero, which is a blank page.
 *
 * `hidden` is what the user had enabled and the new template does not define — the list
 * `docs/UI-UX/05`'s confirmation modal shows before the user commits.
 */
export function recomputeSections(
  currentSections: unknown,
  targetSections: unknown,
  previouslyEnabled: readonly string[],
): { enabled: string[]; hidden: string[] } {
  const oldKeys = new Set(parseSections(currentSections).map((s) => s.key));
  const target = parseSections(targetSections);
  const targetKeys = new Set(target.map((s) => s.key));

  const carried = previouslyEnabled.filter((key) => targetKeys.has(key));
  const hidden = previouslyEnabled.filter((key) => !targetKeys.has(key));

  const arrivals = target
    .filter((s) => s.enabledByDefault && !oldKeys.has(s.key))
    .map((s) => s.key);

  const structural = target.filter((s) => !s.configurable).map((s) => s.key);

  // A Set, then an array: the three sources overlap, and `enabled_sections` is a set
  // everywhere it is read.
  const enabled = [...new Set([...carried, ...arrivals, ...structural])];

  // Ordered by the template's own section order, not by where a key came from. The array is
  // read by the renderer and by a human debugging a page; both expect template order.
  const order = new Map(target.map((s, index) => [s.key, index]));
  enabled.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

  return { enabled, hidden: [...new Set(hidden)] };
}

/**
 * Split a `theme_override` into what the new template permits and what it does not.
 *
 * Keys are compared **exactly**, the same way `P1-14`'s `assertThemeKeysValid` compares them:
 * `colors` permitted does not grant `colors.primary`, and vice versa. Two different rules for
 * the same boundary would eventually disagree, and the one that disagreed quietly would be
 * this one — it runs without a user watching.
 *
 * Values are not re-validated. They passed `assertThemeValuesSafe` on the way in and this
 * function only removes keys; re-checking would turn a template change into a failure for
 * data the product already accepted.
 */
export function dropThemeKeys(
  override: Record<string, unknown>,
  allowed: readonly string[],
): { kept: Record<string, unknown>; dropped: string[] } {
  const permitted = new Set(allowed);
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];

  for (const { key, value } of flatten(override)) {
    if (permitted.has(key)) {
      assign(kept, key, value);
    } else {
      dropped.push(key);
    }
  }

  return { kept, dropped };
}

/** `{ colors: { primary: "#fff" } }` -> `[{ key: "colors.primary", value: "#fff" }]`. */
function flatten(
  value: unknown,
  prefix = "",
): { key: string; value: unknown }[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return prefix === "" ? [] : [{ key: prefix, value }];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

/** The inverse: put `colors.primary` back at `{ colors: { primary } }`. */
function assign(
  target: Record<string, unknown>,
  dottedKey: string,
  value: unknown,
): void {
  const path = dottedKey.split(".");
  const leaf = path.pop()!;

  let cursor = target;
  for (const segment of path) {
    const existing = cursor[segment];
    if (typeof existing !== "object" || existing === null) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[leaf] = value;
}
