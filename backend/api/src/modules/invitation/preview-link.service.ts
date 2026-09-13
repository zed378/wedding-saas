import { createHash, randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { NotFoundError } from "../../http/errors";
import { requireOwnership } from "../../shared/auth-middleware";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";
import type { TenantScope } from "../../shared/tenancy/tenant-scope";

/**
 * `P2-12` — share-preview links, from the owner's side. `docs/API/04` § Preview,
 * `docs/DATABASE/04` § Share-Preview Tokens, `docs/PLAN/04` § F6.
 *
 * ## The token is a credential
 *
 * `docs/DATABASE/04`: *"The token is the only thing between an unpublished invitation and
 * the public internet, so it is treated as a credential: high entropy, stored hashed,
 * expiring, and revocable."* Each of those four is a line below:
 *
 *   - **high entropy** — 256 bits from `randomBytes`, `base64url` so it survives WhatsApp;
 *   - **stored hashed** — SHA-256, and only the hash reaches the database;
 *   - **expiring** — seven days, compared in SQL at resolve time;
 *   - **revocable** — a timestamp the resolve query refuses.
 *
 * SHA-256 rather than argon2, deliberately and with the same reasoning `P1-02`'s
 * single-use tokens recorded: a slow hash protects a low-entropy secret a person chose. A
 * 256-bit random token has nothing to brute-force, and a slow hash on a public route that
 * anyone can hit would be a denial-of-service lever with no security in exchange.
 *
 * ## Returned once
 *
 * `docs/API/04`: *"The token is returned once, at creation, and stored only as a hash."* The
 * list endpoint returns ids and dates, never a token — there is no token to return, which is
 * the point of hashing it.
 */

/** `docs/PLAN/04` § F6: "a temporary link (token, 7-day expiry)". */
export const PREVIEW_LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** The shape a generated token has, so the public route can refuse anything else unqueried. */
export const PREVIEW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashPreviewToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface CreatedPreviewLink {
  readonly id: string;
  /** Shown once. Never stored, never logged, never listed. */
  readonly token: string;
  readonly url: string;
  readonly expires_at: string;
  readonly created_at: string;
}

export interface PreviewLinkSummary {
  readonly id: string;
  readonly expires_at: string;
  readonly created_at: string;
  /** Whether and when somebody opened it — the owner's only signal that a link was used. */
  readonly last_accessed_at: string | null;
}

@Injectable()
export class PreviewLinkService {
  constructor(
    private readonly repository: InvitationRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(
    scope: TenantScope,
    invitationId: string,
    now: Date = new Date(),
  ): Promise<CreatedPreviewLink> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + PREVIEW_LINK_LIFETIME_MS);

    // The owner check is inside the insert (`INSERT … SELECT … WHERE owner_id`), so there is
    // no window in which a token could be minted for somebody else's invitation. `null` is a
    // 404, indistinguishable from an invitation that does not exist (`docs/SECURITY/05`).
    const row = await this.repository.createPreviewToken(invitationId, scope, {
      tokenHash: hashPreviewToken(token),
      expiresAt,
    });
    if (row === null) throw new NotFoundError();

    return {
      id: row.id,
      token,
      url: `${this.env.PUBLIC_INVITE_ORIGIN.replace(/\/+$/, "")}/preview/${token}`,
      expires_at: row.expiresAt.toISOString(),
      created_at: row.createdAt.toISOString(),
    };
  }

  async list(
    scope: TenantScope,
    invitationId: string,
    now: Date = new Date(),
  ): Promise<PreviewLinkSummary[]> {
    // Ownership first, so a stranger gets a 404 rather than an empty list — an empty list
    // for a real invitation id and a 404 for an invented one is an existence oracle.
    await requireOwnership(
      () => this.repository.findOwned(invitationId, scope),
      { scope, resourceType: "invitation", resourceId: invitationId },
    );

    const rows = await this.repository.findOwnedActivePreviewTokens(
      invitationId,
      scope,
      now,
    );

    return rows.map((row) => ({
      id: row.id,
      expires_at: row.expiresAt.toISOString(),
      created_at: row.createdAt.toISOString(),
      last_accessed_at: row.lastAccessedAt?.toISOString() ?? null,
    }));
  }

  async revoke(
    scope: TenantScope,
    invitationId: string,
    tokenId: string,
    now: Date = new Date(),
  ): Promise<void> {
    const revoked = await this.repository.revokeOwnedPreviewToken(
      tokenId,
      invitationId,
      scope,
      now,
    );
    if (!revoked) throw new NotFoundError();
  }
}
