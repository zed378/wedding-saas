# 08 - Color System (Application)

As with Typography, this is for the application chrome — not the invitation template colors (per-template theme is separate, see PLAN/07).

## Core Palette
```
Primary:    #4F46E5 (indigo) — main buttons, active links, brand elements
Secondary:  #F59E0B (amber) — accents, promo highlights/premium badges
Neutral:    #FAFAFA (50) → #171717 (900) — text, background, borders
Success:    #16A34A — published status, success confirmations
Warning:    #F59E0B — pending status, warnings
Danger:     #DC2626 — errors, destructive actions, expired status
Info:       #0EA5E9 — informational notifications
```

## Invitation Status (Badge)
| Status | Color |
|---|---|
| draft | neutral-400 |
| pending_payment | warning |
| paid | info |
| published | success |
| expired | danger (muted) |

## Contrast & Accessibility
- All text-background combinations above are validated to reach a minimum contrast ratio of 4.5:1 (normal text) / 3:1 (large text ≥18px bold) per WCAG AA — see 17-ACCESSIBILITY.md.
- Color is NEVER the sole indicator of information (e.g., status is also accompanied by a text label/icon, not just the badge color) — important for color-blind users.

## Dark Mode
- Not mandatory for the MVP; if added, all the tokens above have a paired dark variant whose structure is already planned in the design tokens (not hard-coded colors per component).
