# 17 - Acceptance Criteria (MVP Release Gate)

Measurable criteria, all of which must pass before the MVP is considered "release-ready." Each criterion references the source document of truth.

## Functional
- [ ] Users can register, verify their email, and log in (email & Google OAuth) — ref 01-PRODUCT-REQUIREMENTS FR-1.
- [ ] Users can select a template, fill in all entity data (08-INVITATION-DATA-MODEL), autosave works without data loss across 100 consecutive changes.
- [ ] Users can switch templates without losing data (BR-3, tested with a scenario where fields disappear and reappear).
- [ ] Checkout → Payment → Webhook → `paid` status succeeds end-to-end with a sandbox gateway, including failure/expiry scenarios.
- [ ] Publishing produces a public page accessible via subdomain within < 5 seconds of publishing.
- [ ] Public RSVP & Guestbook work correctly, including moderation on/off.
- [ ] Admins can perform template CRUD, manage orders (refund), moderate content — all logged in the audit log.

## Non-Functional — Performance
- [ ] Public invitation page: LCP < 2.5s on a simulated 4G connection (see FRONTEND/09-PERFORMANCE.md).
- [ ] Editor: section changes reflected in the preview in < 300ms (client-side, no server round-trip).
- [ ] API p95 response time < 500ms for standard CRUD endpoints (non-upload).

## Non-Functional — Security
- [ ] IDOR testing across all `:id` endpoints — User A cannot access/modify User B's resources (0 critical findings, see SECURITY/11-SECURITY-TESTING.md).
- [ ] File upload: every vector in SECURITY/06-FILE-UPLOAD-SECURITY.md is tested (MIME spoofing, decompression bomb, etc.) — 0 critical findings.
- [ ] Payment status cannot be manipulated from the client (tested via redirect parameter tampering) — ref SECURITY/07-PAYMENT-SECURITY.md.
- [ ] All free-text input (names, quotes, guestbook) does not result in stored XSS when rendered on the public page.

## Non-Functional — Availability
- [ ] Staging uptime during a 2-week UAT period > 99%.
- [ ] Disaster recovery: database backup restore successfully tested at least once before launch (ARCHITECTURE/09-DISASTER-RECOVERY.md).

## Non-Functional — Accessibility
- [ ] The public page & editor pass a basic WCAG 2.1 AA audit for color contrast & keyboard navigation (UI-UX/17-ACCESSIBILITY.md).

## Sign-off
The MVP release requires sign-off from: Product Owner, Engineering Lead, Security reviewer (checklist SECURITY/11).
