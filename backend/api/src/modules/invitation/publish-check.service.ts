import { Injectable } from "@nestjs/common";
import {
  collectMissingRequiredFields,
  describeMissingField,
  type SectionDefinition,
} from "@wi/schema";

import type { ErrorDetail } from "../../http/envelope";
import { requireOwnership } from "../../shared/auth-middleware";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";
import { toInvitationDetail } from "./invitation.dto";

/**
 * P2-06 — what is still missing before this invitation can be published. BR-4.2.
 *
 * ## A disabled section's required fields do not block anything
 *
 * This is the card's first DoD item and the whole reason the enablement check comes
 * first. A template defines a gift section with a required account number; a couple who
 * turned the gift section off has no account number and is not incomplete — they made a
 * choice. Checking every `required_fields` path in the definition would refuse to publish
 * an invitation that is exactly as the user wants it.
 *
 * `collectMissingRequiredFields` (`P0-20`) already encodes that order, which is why this
 * service assembles inputs rather than re-implementing the rule.
 *
 * ## The same shape as the publish 422
 *
 * `docs/API/04`: "POST /publish returns a 422 with `details[]` listing the missing
 * fields". This endpoint returns the same `details[]`, so the editor has one rendering
 * path for "here is what is left" and "you cannot publish yet, here is why" — two
 * renderings of one list is how they drift.
 */

export interface PublishCheckResult {
  readonly ready: boolean;
  /** `docs/API/00`'s `ErrorDetail`, identical to what `POST /publish` returns on 422. */
  readonly details: readonly ErrorDetail[];
  /** Section keys with at least one missing field, for the editor's sidebar marks. */
  readonly incomplete_sections: readonly string[];
}

@Injectable()
export class PublishCheckService {
  constructor(private readonly repository: InvitationRepository) {}

  async check(
    scope: TenantScope,
    invitationId: string,
  ): Promise<PublishCheckResult> {
    const invitation = await requireOwnership(
      () => this.repository.findOwned(invitationId, scope),
      { scope, resourceType: "invitation", resourceId: invitationId },
    );

    const [aggregate, definition] = await Promise.all([
      this.repository.loadAggregate(invitationId, scope),
      this.repository.findTemplateVersionFor(invitationId, scope),
    ]);

    if (definition === null) {
      // No definition means nothing declares a requirement. Ready rather than blocked:
      // refusing to publish because the server could not read the template would be a
      // server problem presented to the user as their incompleteness.
      return { ready: true, details: [], incomplete_sections: [] };
    }

    const detail = toInvitationDetail(invitation, aggregate, {
      slug: "",
      name: "",
      version: "",
    });

    return summarise(
      collectMissingRequiredFields(
        definition.sections as readonly SectionDefinition[],
        detail.settings.enabled_sections,
        detail,
      ),
    );
  }
}

/**
 * Turn the resolver's output into the wire shape.
 *
 * The resolver deliberately repeats a path that two enabled sections both require —
 * `P0-20`'s comment explains that the repetition is information, because it says which
 * sections are blocked. The `details[]` keep that repetition (each entry names its
 * section) while `incomplete_sections` is the deduped set the sidebar needs.
 */
export function summarise(
  missing: readonly { readonly sectionKey: string; readonly path: string }[],
): PublishCheckResult {
  return {
    ready: missing.length === 0,
    details: missing.map((item) => ({
      // The canonical path as `field`, because a client that wants to focus the control
      // needs the machine-readable half -- and the message is what it renders.
      field: item.path,
      message: describeMissingField(item),
    })),
    incomplete_sections: [...new Set(missing.map((item) => item.sectionKey))],
  };
}
