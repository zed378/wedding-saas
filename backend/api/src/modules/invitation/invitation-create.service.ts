import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { templateVersions, templates } from "../../infra/db/schema/templates";
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../http/errors";
import { logger } from "../../shared/logging/logger";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";
import { InvitationStatusService } from "../../shared/invitation-status/invitation-status.service";
import { parseSections } from "./settings.service";
import { SlugService } from "./slug.service";

/**
 * P1-09 — creating an invitation. `docs/API/04`, BR-1.4 and BR-3.
 *
 * ## Where the writes live
 *
 * Not here. `InvitationRepository.createAggregate` performs them, because `owner_id` is
 * written at creation and `shared/tenancy/` is the layer that owns that column —
 * `scripts/check-tenant-scope.mjs` refuses a direct import of these tables anywhere else.
 * Adding this module to that script's ALLOWED list would have been the cheaper change and
 * the wrong one; its own comment says every addition deserves a sentence saying what it
 * costs, and this one would have cost the guarantee the whole layer exists for.
 *
 * What lives here is the decisions: which version, which sections, whether the slug is
 * usable, and whether the quota allows it.
 *
 * ## The version is resolved once, here, and never again
 *
 * BR-3.1: an invitation stores a concrete `template_version_id`, not "latest". The rule
 * exists because an admin editing a template must not change the appearance of an
 * invitation that has already been sent to three hundred guests. Storing "latest" — or
 * resolving the version at read time — **is** the bug this rule was written to prevent.
 *
 * ## The free-draft quota counts what has never been paid
 *
 * BR-1.4 and ADR-023. Not "how many drafts do you have" — an organiser with five paid
 * invitations must still be able to start a sixth. The predicate itself lives in
 * `InvitationRepository.findUnpaidInvitation`, with the note about why the obvious
 * shortening is wrong.
 */

export interface CreateInvitationInput {
  readonly templateId: string;
  readonly internalName: string;
  readonly slug?: string | undefined;
}

export interface CreatedInvitation {
  readonly id: string;
  readonly slug: string | null;
  readonly status: string;
  readonly templateId: string;
  readonly templateVersionId: string;
}

@Injectable()
export class InvitationCreateService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly slugs: SlugService,
    private readonly status: InvitationStatusService,
    private readonly repository: InvitationRepository,
  ) {}

  async create(
    scope: TenantScope,
    input: CreateInvitationInput,
  ): Promise<CreatedInvitation> {
    const version = await this.resolvePublishedVersion(input.templateId);

    // Before the quota check and before any write: a rejected slug should not depend on
    // how many drafts the caller happens to have.
    //
    // Trimmed but NOT lowercased. Uppercase is rejected rather than normalised, because
    // the slug is the invitation's public address and a URL path is case-sensitive:
    // silently storing `budi-dan-ani` for somebody who typed `Budi-Dan-Ani` gives them an
    // address that does not resolve, and they may have printed it on a card before
    // finding out.
    const slug = input.slug?.trim();
    if (slug !== undefined && slug.length > 0) {
      await this.assertSlugUsable(slug);
    }

    await this.assertFreeDraftQuota(scope);

    const created = await this.repository.createAggregate(
      scope,
      {
        internalName: input.internalName.trim(),
        templateId: input.templateId,
        // The concrete version, resolved above. BR-3.1.
        templateVersionId: version.id,
        slug: slug !== undefined && slug.length > 0 ? slug : null,
        // From the template, not a hard-coded list: which sections a new invitation
        // starts with is a property of the template's design (`docs/PLAN/07`).
        enabledSections: defaultSections(version.sections),
      },
      // In the same transaction as the rows it describes. An invitation whose creation
      // has no history row is one nobody can reconstruct.
      (tx, invitationId) =>
        this.status.recordCreation(tx, invitationId, {
          kind: "USER",
          userId: scope,
        }),
    );

    logger.info(
      {
        context: {
          user_id: scope,
          invitation_id: created.id,
          event: "invitation.created",
          template_version_id: created.templateVersionId,
        },
      },
      "invitation created",
    );

    return {
      id: created.id,
      slug: created.slug,
      status: created.status,
      templateId: created.templateId,
      templateVersionId: created.templateVersionId,
    };
  }

  /**
   * The template's current published version.
   *
   * BR-3.3: a deprecated template "can still be rendered for existing invitations that
   * reference it, but no longer appears in the catalog for new invitations". So a
   * `draft` or `deprecated` version is refused **here**, at creation, and nowhere else —
   * an invitation already pointing at one keeps working.
   */
  private async resolvePublishedVersion(
    templateId: string,
  ): Promise<{ id: string; sections: unknown }> {
    const [template] = await this.db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.id, templateId))
      .limit(1);

    // 404 rather than a validation error: from the caller's side an unknown template id
    // and a template that does not exist are the same thing.
    if (template === undefined) throw new NotFoundError();

    const [version] = await this.db
      .select({ id: templateVersions.id, sections: templateVersions.sections })
      .from(templateVersions)
      .where(
        and(
          eq(templateVersions.templateId, templateId),
          eq(templateVersions.status, "published"),
        ),
      )
      // The newest published one. A template may have several published versions over
      // time; a new invitation locks the current one.
      .orderBy(desc(templateVersions.createdAt))
      .limit(1);

    if (version === undefined) {
      // The template exists but has nothing publishable. BR-3.3.
      throw new BusinessRuleError(
        "TEMPLATE_NOT_AVAILABLE",
        "Template ini belum tersedia untuk undangan baru.",
      );
    }

    return version;
  }

  private async assertSlugUsable(slug: string): Promise<void> {
    const rejection = await this.slugs.check(slug);
    if (rejection === undefined) return;

    // 409 for "taken", 400 for the rest. `docs/API/04` names SLUG_TAKEN, and the
    // distinction matters to whoever is typing: one means pick another address, the other
    // means this is not a valid address at all.
    if (rejection.kind === "taken") {
      throw new ConflictError("SLUG_TAKEN", rejection.message);
    }

    throw new ValidationError([{ field: "slug", message: rejection.message }]);
  }

  private async assertFreeDraftQuota(scope: TenantScope): Promise<void> {
    const existing = await this.repository.findUnpaidInvitation(scope);
    if (existing === undefined) return;

    // Names the existing invitation, as BR-1.4 requires — otherwise the user is told they
    // have one and left to find it.
    throw new BusinessRuleError(
      "FREE_DRAFT_LIMIT_REACHED",
      `Anda masih memiliki undangan yang belum dibayar: "${existing.internalName ?? "tanpa nama"}". Selesaikan atau hapus undangan tersebut sebelum membuat yang baru.`,
      [{ field: "invitation_id", message: existing.id }],
    );
  }
}

/**
 * The section keys a template marks `enabled_by_default`. `docs/PLAN/07`.
 *
 * The field is `section_key`, not `key` — the name `P0-20`'s schema uses. The first
 * version of this read `key`, which produced an empty `enabled_sections` array on every new
 * invitation: a silent, total failure that renders as a blank invitation rather than an
 * error. Caught by the test that compares against the template's own sections.
 *
 * `P1-15` moved the actual parsing into `parseSections`, which needs the same three fields
 * to recompute a selection across a template change. Two readers of one `jsonb` column
 * would eventually disagree about a default, and the disagreement would appear as a section
 * that is on for a new invitation and off after a template change — the kind of difference
 * nobody attributes to a parser.
 */
export function defaultSections(sections: unknown): string[] {
  return parseSections(sections)
    .filter((section) => section.enabledByDefault)
    .map((section) => section.key);
}
