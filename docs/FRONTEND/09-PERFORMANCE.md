# 09 - Performance

## Target (aligned with PLAN/17-ACCEPTANCE-CRITERIA.md)
- Public Invitation: LCP < 2.5s, CLS < 0.1, good FID/INP, tested on a simulated 4G connection.
- Editor: a section change → preview update in < 300ms (client-side, no round-trip).
- Catalog/Landing: green Core Web Vitals (an SEO factor, PLAN/15).

## Public Invitation Techniques (High Priority)
- SSR/pre-rendering (07-PUBLIC-INVITATION.md) — avoid a client-side fetch waterfall for the main content.
- Image: WebP format, responsive `srcset`, lazy-load non-critical images, `priority`/eager loading only for the cover photo (the LCP element).
- Fonts: subset & preload critical fonts, `font-display: swap` to prevent invisible text.
- Inline critical CSS for above-the-fold content, lazy-load the rest.
- Avoid layout shift: reserve image/section dimensions before loading (`width`/`height` or CSS aspect-ratio) — contributes to CLS.
- Minimize the public page's JS bundle (aggressive code-splitting, section components loaded only for the active template, not bundling every possible template).

## Editor Techniques
- The Live Preview does not perform a network request on every keystroke (see 06-EDITOR-ARCHITECTURE.md).
- Virtualize lists if the gallery/RSVP list is very long.
- Debounce/throttle expensive operations (reorder, preview resize).

## Backend-side Contribution
- Aggressive caching (ARCHITECTURE/06) reduces server-side rendering load under high traffic.
- CDN for all static assets & media.

## Monitoring
- Real User Monitoring (RUM) for Core Web Vitals in production (e.g., via Vercel Analytics/a self-hosted equivalent) — not just lab testing (Lighthouse) once during development.

## Budget
- Public Invitation JS bundle: target < 150KB gzip for the initial load (excluding images) — re-evaluated as template complexity grows.
