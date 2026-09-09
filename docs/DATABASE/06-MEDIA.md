# 06 - Table: media, invitation_gallery, invitation_bank_accounts, invitation_quote

```sql
CREATE TABLE media (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id        UUID REFERENCES invitations(id) ON DELETE CASCADE,  -- NULL for template_assets
  uploaded_by             UUID REFERENCES users(id),
  purpose                    VARCHAR(30) NOT NULL,          -- 'gallery' | 'profile' | 'cover' | 'template_asset'
  status                       VARCHAR(20) NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','ready','failed')),
  storage_path                    VARCHAR(500) NOT NULL,
  mime_type                          VARCHAR(60),
  width                                 INT,
  height                                 INT,
  size_bytes                              BIGINT,
  created_at                                TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                                 TIMESTAMPTZ
);
CREATE INDEX idx_media_invitation ON media(invitation_id);

CREATE TABLE invitation_gallery (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id        UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  media_id                UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  caption                    VARCHAR(200),
  display_order                 INT NOT NULL DEFAULT 0,
  is_cover                        BOOLEAN NOT NULL DEFAULT false,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gallery_invitation ON invitation_gallery(invitation_id);

CREATE TABLE invitation_bank_accounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id        UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  type                    VARCHAR(10) NOT NULL CHECK (type IN ('bank','ewallet')),
  provider_name              VARCHAR(60) NOT NULL,
  account_number                VARCHAR(60) NOT NULL,
  account_holder                    VARCHAR(150) NOT NULL,
  display_order                        INT NOT NULL DEFAULT 0,
  created_at                              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invitation_quote (
  invitation_id       UUID PRIMARY KEY REFERENCES invitations(id) ON DELETE CASCADE,
  text                    TEXT,
  source                     VARCHAR(200),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Data Security Note
- `invitation_bank_accounts.account_number` is sensitive financial data — even though it is intentionally displayed by the owner on the public page (for digital gifts), access through the authenticated (editor) API remains subject to full object-level authorization (SECURITY/05). Encryption at rest for this column is also considered (SECURITY/09-PRIVACY-DATA-PROTECTION.md).
