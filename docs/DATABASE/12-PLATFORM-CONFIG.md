# 12 - Table: slug_blocklist

Backs the reserved-word and profanity blocklist required by SECURITY/10-ABUSE-PREVENTION.md § Slug Blocklist and PLAN/10-DOMAIN-PUBLISHING.md § Subdomain.

SECURITY/10 requires the list to be "managed by admins, updatable without a deploy", which makes it data rather than a constant in code.

```sql
CREATE TABLE slug_blocklist (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term                VARCHAR(60) NOT NULL,
  match_type          VARCHAR(20) NOT NULL DEFAULT 'exact'
                      CHECK (match_type IN ('exact','substring')),
  category            VARCHAR(30) NOT NULL DEFAULT 'reserved'
                      CHECK (category IN ('reserved','profanity','brand','other')),
  reason              TEXT,
  created_by          UUID REFERENCES users(id),      -- NULL for seeded system entries
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_slug_blocklist_term ON slug_blocklist(lower(term), match_type);
```

## Match Semantics

- `exact` — the whole slug equals the term. Used for reserved system words: `admin`, `api`, `www`, `app`, `mail`, `ftp`, `static`, `cdn`, `assets`, `webhooks`, `status`, `support`, `help`, `blog`, `login`, `register`, `checkout`, `preview`. Blocking these as substrings would reject legitimate names — `sandi-april` contains `and`, `wawan` contains `www` only if matched loosely, and a couple named Aprilia should not lose their slug to a routing concern.
- `substring` — the term appears anywhere in the slug. Reserved for profanity and hate speech, where evasion by padding is the whole point.

Matching is case-insensitive, applied after the slug is normalized to lowercase. SECURITY/10 also asks for basic leetspeak folding (`4`→`a`, `3`→`e`, `1`→`i`, `0`→`o`) before substring comparison; that normalization happens in the service, not in the query, so the stored term stays readable.

## Seeding and Caching

Seeded with the reserved words above plus an initial profanity list, as **seed data** rather than a migration (DATABASE/00 conventions: schema and content are separate concerns).

Slug validation runs on every invitation creation and every slug change, so the list is cached in Redis and invalidated when an admin edits it (ARCHITECTURE/06).

## Governance

Every change is an admin write action and therefore writes to `audit_logs` (DATABASE/10). Adding a term does **not** retroactively invalidate slugs already in use; the admin UI reports which existing slugs a new term would have matched so the decision to act on them is explicit and separate (see PLAN/12-ADMIN-PANEL.md).

## Related Risk

This table is the mitigation for R7 in PLAN/18-RISK-REGISTER.md (slug hijacking and squatting of popular names), together with the per-user rate limit on invitation creation in SECURITY/10.
