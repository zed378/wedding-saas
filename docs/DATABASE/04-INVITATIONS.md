# 04 - Table: invitations, invitation_settings, invitation_status_history

```sql
CREATE TABLE invitations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  internal_name            VARCHAR(150),                    -- for multi-invitation users, not public
  template_id               UUID NOT NULL REFERENCES templates(id) ON DELETE RESTRICT,
  template_version_id        UUID NOT NULL REFERENCES template_versions(id) ON DELETE RESTRICT,
  status                     VARCHAR(20) NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','pending_payment','paid','published','expired','soft_deleted')),
  slug                        VARCHAR(50) UNIQUE,
  published_at                TIMESTAMPTZ,
  expiry_date                  DATE,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                    TIMESTAMPTZ
);
CREATE INDEX idx_invitations_owner ON invitations(owner_id);
CREATE UNIQUE INDEX idx_invitations_slug ON invitations(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_invitations_status ON invitations(status);

CREATE TABLE invitation_settings (
  invitation_id             UUID PRIMARY KEY REFERENCES invitations(id) ON DELETE CASCADE,
  enabled_sections            VARCHAR(40)[] NOT NULL DEFAULT '{}',
  theme_override               JSONB NOT NULL DEFAULT '{}',
  rsvp_enabled                  BOOLEAN NOT NULL DEFAULT true,
  guestbook_enabled              BOOLEAN NOT NULL DEFAULT true,
  guestbook_moderation             BOOLEAN NOT NULL DEFAULT false,
  seo_indexable                     BOOLEAN NOT NULL DEFAULT false,
  updated_at                         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invitation_status_history (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id              UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  from_status                 VARCHAR(20),
  to_status                    VARCHAR(20) NOT NULL,
  changed_by                    UUID REFERENCES users(id),     -- NULL if changed by the system/an automatic job
  reason                         TEXT,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_status_history_invitation ON invitation_status_history(invitation_id);
```

## Share-Preview Tokens

Backs `POST /invitations/:id/preview-link` (API/04 § Preview, PLAN/04 § F6). The token is the only thing between an unpublished invitation and the public internet, so it is treated as a credential: high entropy, stored hashed, expiring, and revocable.

```sql
CREATE TABLE invitation_preview_tokens (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id             UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  token_hash                VARCHAR(255) NOT NULL,
  created_by                UUID NOT NULL REFERENCES users(id),
  expires_at                TIMESTAMPTZ NOT NULL,
  revoked_at                TIMESTAMPTZ,
  last_accessed_at          TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_preview_tokens_hash ON invitation_preview_tokens(token_hash);
CREATE INDEX idx_preview_tokens_invitation ON invitation_preview_tokens(invitation_id) WHERE revoked_at IS NULL;
```

- Default expiry 7 days (PLAN/04 § F6).
- A preview response is always `noindex` and always watermarked, regardless of the invitation's `seo_indexable` setting.
- RSVP and guestbook submissions are disabled in preview mode — a preview must not create real guest rows.
- An expired, revoked and never-existing token all produce the same response, for the same anti-enumeration reason as the public slug lookup (SECURITY/10).

## Custom Domain (Phase 2, separate table)
```sql
CREATE TABLE invitation_custom_domains (
  invitation_id             UUID PRIMARY KEY REFERENCES invitations(id) ON DELETE CASCADE,
  domain                      VARCHAR(255) NOT NULL UNIQUE,
  verification_status           VARCHAR(20) NOT NULL DEFAULT 'pending_verification'
                                CHECK (verification_status IN ('pending_verification','verified','active','failed')),
  ssl_status                     VARCHAR(20) NOT NULL DEFAULT 'pending',
  verified_at                     TIMESTAMPTZ,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Notes
- The `slug` unique constraint only applies to rows where `deleted_at IS NULL` (partial unique index) so a slug can be reused after the old invitation is truly deleted.
- Every `status` transition MUST write a new row to `invitation_status_history` (see PLAN/06-INVITATION-LIFECYCLE.md) — done at the service layer, not via a DB trigger, so `changed_by`/`reason` can be filled from the application context.
