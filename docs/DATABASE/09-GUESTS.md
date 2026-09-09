# 09 - Table: invitation_guests (RSVP), invitation_guestbook

```sql
CREATE TABLE invitation_guests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id        UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  guest_name              VARCHAR(150) NOT NULL,
  attendance_status          VARCHAR(15) NOT NULL CHECK (attendance_status IN ('attending','not_attending','maybe')),
  guest_count                  INT NOT NULL DEFAULT 1 CHECK (guest_count BETWEEN 1 AND 10),
  message                        TEXT,
  submitted_ip_hash                 VARCHAR(64),          -- hashed, not the raw IP (privacy)
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_guests_invitation ON invitation_guests(invitation_id);

CREATE TABLE invitation_guestbook (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id        UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  guest_name              VARCHAR(150) NOT NULL,
  message                    TEXT NOT NULL,
  status                        VARCHAR(15) NOT NULL DEFAULT 'approved'
                                CHECK (status IN ('pending','approved','rejected')),
  submitted_ip_hash                 VARCHAR(64),
  moderated_by                        UUID REFERENCES users(id),
  moderated_at                          TIMESTAMPTZ,
  created_at                              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_guestbook_invitation ON invitation_guestbook(invitation_id, status);
```

## Notes
- `status` defaults to `approved` but the service layer overrides it to `pending` on insert if `invitation_settings.guestbook_moderation = true` (see API/08-PUBLIC-INVITATION-API.md).
- `submitted_ip_hash` (not the raw IP) is used for rate-limiting/spam detection while preserving visitor privacy (SECURITY/09, SECURITY/10).
- `message` is sanitized against HTML/script before saving (stored XSS prevention, SECURITY/08).
- There is no FK to `users` for `guest_name` — guests are anonymous/accountless by design.
