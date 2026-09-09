# 07 - Typography (Application)

Note: This typography spec is for the APPLICATION CHROME (dashboard, editor, admin). The typography for INVITATION TEMPLATES is defined per-template in `theme.typography` (see PLAN/07-TEMPLATE-SYSTEM.md) — entirely separate from this system.

## Font Family
- Primary (UI): a modern sans-serif, e.g., Inter/Plus Jakarta Sans — legible at small sizes, supports extended Latin (Indonesian names with diacritics, if any).
- Monospace (for code/slug previews if needed): e.g., JetBrains Mono.

## Type Scale
| Token | Size | Line-height | Usage |
|---|---|---|---|
| display | 36px | 1.2 | Main page titles (Dashboard, Landing hero) |
| h1 | 28px | 1.25 | Section title |
| h2 | 22px | 1.3 | Sub-heading |
| h3 | 18px | 1.4 | Card/modal title |
| body-lg | 16px | 1.5 | Primary body text |
| body | 14px | 1.5 | Default UI text, labels |
| body-sm | 12px | 1.5 | Helper text, captions |
| button | 14px | 1 | Button label, medium weight |

## Weight
- Regular (400): body text.
- Medium (500): labels, buttons.
- Semibold (600): small headings, emphasis.
- Bold (700): large headings.

## Principles
- Maximum of 2 font families in the app (UI font + optional monospace) — don't add decorative fonts to the app chrome (leave the decorative character to the templates).
- Minimum WCAG AA text contrast (see 17-ACCESSIBILITY.md).
