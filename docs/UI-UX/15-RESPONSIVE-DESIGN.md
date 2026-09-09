# 15 - Responsive Design

## Strategy per Application
| App | Strategy |
|---|---|
| Public Invitation | Purely mobile-first, desktop is "letterboxed" — a mobile-width view centered on a large screen (because the invitation is visually designed with a mobile aspect ratio in mind) — a common pattern in the digital invitation industry. |
| Marketing/Landing/Catalog | Fully responsive, desktop-enhanced (more columns in the grid, a larger hero). |
| Editor | Desktop-optimized (3-column), tab-mode fallback on mobile/tablet (see 12-EDITOR-UX.md). |
| Admin Panel | Desktop-first (assumed to be used from a work computer), basic responsiveness for tablet, mobile is not an MVP priority. |

## Breakpoints (consistent with 09-SPACING-GRID.md)
```
mobile:  < 640px
tablet:  640-1024px
desktop: > 1024px
```

## Common Adaptation Patterns
- Tables (RSVP list, Order list) → become card-stacks on mobile (not a horizontally scrolling table, which is hard to read).
- Modal fullscreen on mobile, a centered dialog on desktop.
- Sidebar navigation → bottom navigation or a hamburger menu on mobile.

## Testing
- Must be tested on real viewports common in Indonesia: 360x800 (a typical Android low-mid range device), 390x844 (a standard iPhone), in addition to desktop at 1440px — see TESTING/06-CROSS-BROWSER.md.
