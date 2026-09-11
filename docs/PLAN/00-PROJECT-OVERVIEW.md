# 00 - Project Overview

## Product Name
WeddingInvite (working name) — A SaaS platform for creating digital wedding invitations based on templates.

## Product Goal
Enable engaged couples to create, publish, and share digital wedding invitations independently (self-service), without developer involvement, in under 30 minutes from template selection to publish.

## Target Customers
- **Primary**: Engaged couples (ages 22-35) organizing their own wedding, digitally literate, with limited-to-medium budgets.
- **Secondary**: Wedding organizers (WO) who create invitations for many clients (need multi-invitation management).
- **Tertiary**: Internal platform admins (managing templates, orders, content).

## Value Proposition
- Professional digital invitations without needing a designer/developer.
- Templates can be customized (not just text content, but sections, colors, limited layout).
- Complete wedding features: RSVP, digital gift envelope (bank account/e-wallet), gallery, maps, countdown, guestbook.
- Publish to a free address on the platform's domain (`invitation.vizunicum.my.id/{slug}` at MVP — see PLAN/10-DOMAIN-PUBLISHING.md), with a custom domain planned for Phase 2.

## Business Model
- **Freemium/Pay-per-invitation**: a user holds **one free draft** (watermarked preview, cannot publish) → pays **once** to publish.
- **Price: Rp 139,000 for 12 months of live invitation**, one package, no tiers. Renewal is another Rp 139,000 for another 12 months, made deliberately by the user. See PLAN/09-ORDER-PAYMENT.md and MEMORY ADR-023.
- Deliberately cheap: the effort of producing a wedding invitation belongs to the couple, not to the platform.
- **Add-ons**: defined in the schema but none active at MVP — custom domain waits for the Phase 2 feature, extended validity is redundant beside a 12-month package.
- Not subscription-based at MVP: this is a one-time payment with an expiry, not recurring billing (a "Pro Plan" for WOs remains a Phase 2 possibility).

## MVP Scope
1. Registration/login (email + Google OAuth).
2. Browse & select templates (minimum 5 templates).
3. Invitation editor (couple info, event, gallery, maps, gift/bank account, quote, RSVP, guestbook).
4. Real-time preview (desktop & mobile).
5. Checkout & payment (minimum 1 local payment gateway — Midtrans/Xendit).
6. Publish to a platform address (`invitation.vizunicum.my.id/{slug}` at MVP — see PLAN/10-DOMAIN-PUBLISHING.md).
7. Public invitation page (mobile-first, responsive, shareable link).
8. Public RSVP & guestbook (stored, viewable by the owner).
9. Basic admin panel (manage users, orders, templates, moderation).

## Phase 2 Scope
- Custom domain (automatic DNS mapping + SSL).
- Multiple invitations per user (for WOs).
- Analytics dashboard (visitor count, RSVP conversion).
- Automatic WhatsApp/email notifications (event reminders, RSVP confirmations).
- Template marketplace (external contributors).
- Multi-language invitations (ID/EN).

## Future Scope
- White-label for WOs/vendors.
- Integrated live streaming of the event.
- Digital gift tracking integrated with a payment gateway (not just a static account number).
- Native mobile app.

## Assumptions
- Public invitation traffic is "spiky" (high near/on the event date, then drops sharply) — the architecture must support aggressive caching.
- Most users access from mobile (>80%).
- Personal data (names, addresses, bank accounts) is sensitive, even if not fully financial PII — it needs protection equivalent to general personal data.

## Constraints
- Limited initial infrastructure budget → prioritize architecture that is cheap when idle and cheap to scale during high-traffic moments (serverless/edge caching considered).
- Small team (assumed 1-3 engineers) → avoid over-engineering in the MVP.
- Must support adding new templates without redeploying the application (data-driven template system, see 07-TEMPLATE-SYSTEM.md).

## Success Metrics (MVP)
- Average time-to-publish < 30 minutes.
- Draft → paid publish conversion > 15%.
- Public invitation page uptime > 99.5%.
- Zero cross-tenant IDOR/data leak incidents (zero tolerance — see SECURITY/05-MULTI-TENANCY-SECURITY.md).

## Out of Scope (MVP)
- Installment payments.
- Multi-currency.
- Native mobile app.
- AI-generated content/photos.
