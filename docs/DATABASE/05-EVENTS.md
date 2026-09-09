# 05 - Table: invitation_people, invitation_events

```sql
CREATE TABLE invitation_people (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id        UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  role                   VARCHAR(10) NOT NULL CHECK (role IN ('groom','bride')),
  full_name               VARCHAR(150) NOT NULL DEFAULT '',
  nickname                 VARCHAR(60) NOT NULL DEFAULT '',
  photo_media_id             UUID REFERENCES media(id),
  instagram                   VARCHAR(60),
  father_name                  VARCHAR(150),
  mother_name                   VARCHAR(150),
  child_order                    VARCHAR(60),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (invitation_id, role)
);

CREATE TABLE invitation_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id        UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  type                   VARCHAR(20) NOT NULL CHECK (type IN ('akad','reception','custom')),
  title                    VARCHAR(150) NOT NULL,
  event_date                DATE NOT NULL,
  start_time                  TIME NOT NULL,
  end_time                     TIME,
  venue_name                    VARCHAR(200) NOT NULL,
  address                         TEXT NOT NULL,
  latitude                         DECIMAL(9,6),
  longitude                          DECIMAL(9,6),
  maps_url                            VARCHAR(500),
  description                          TEXT,
  display_order                          INT NOT NULL DEFAULT 0,
  created_at                                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_invitation ON invitation_events(invitation_id);
```

## Notes
- `invitation_people` is limited to 2 rows per invitation via the `UNIQUE (invitation_id, role)` constraint — a design matching the domain model (Groom & Bride), not a generic N-person setup for MVP.
- `invitation_events` supports N events per invitation (Akad, Reception, custom events like a post-wedding reception) per PLAN/08.
- `maps_url` is auto-generated from `latitude/longitude` at the service layer if left empty during create/update (BACKEND/02-SERVICE-LAYER.md).
