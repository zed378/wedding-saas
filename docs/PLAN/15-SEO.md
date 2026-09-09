# 15 - SEO

## Public Invitation Page
- Dynamic meta tags per invitation: `<title>`, `og:title`, `og:description`, `og:image` (from the cover photo), `og:type=website`, `twitter:card=summary_large_image`.
- Canonical URL using the active subdomain/custom domain.
- Robots: `noindex` can optionally be enabled by the user (privacy — some couples don't want their invitation indexed by Google, see SECURITY/09-PRIVACY-DATA-PROTECTION.md). Default: `noindex` to protect guest data privacy (RSVP/guestbook), UNLESS the user explicitly enables indexing.
- Structured data (schema.org `Event`) optional for easy sharing, without sensitive data (does not include bank account numbers, etc.).

## Marketing Pages (Landing, Template Catalog)
- Full SEO optimization: sitemap.xml, complete meta tags, indexable, fast loading (SSR/SSG).
- Template detail pages as a target for long-tail keywords ("modern online wedding invitation," etc.).

## Performance as an SEO Factor
- Core Web Vitals targeted to be green (LCP < 2.5s, CLS < 0.1) especially for the landing page & catalog — see FRONTEND/09-PERFORMANCE.md.

## Architecture Note
- The public invitation page should ideally be server-side rendered or static-generated-on-publish + revalidate-on-update (ISR-like) so that og:image/meta is crawled correctly by sharing bots (WhatsApp/Facebook), not a pure client-side SPA — see FRONTEND/07-PUBLIC-INVITATION.md.
