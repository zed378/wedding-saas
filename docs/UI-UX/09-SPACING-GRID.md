# 09 - Spacing & Grid

## Base Unit
- A 4px base unit. Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96 (px).
- Spacing between form elements: 16px (label-input: 8px, between fields: 16-24px, between sections: 32-48px).

## Grid System (Web Application)
- Desktop: 12-column grid, max-width container 1280px, 24px gutter.
- Tablet: 8-column grid, 16px gutter.
- Mobile: 4-column grid (or single-column stack), 16px gutter, 16px horizontal padding.

## Breakpoints
```
mobile:  < 640px
tablet:  640px - 1024px
desktop: > 1024px
```

## Editor Layout (Desktop, 3-column)
```
Section List: 240px fixed
Live Preview: flex-grow (center, max representative mobile width ~375px within the frame)
Properties Panel: 320px fixed
```
On mobile, this layout becomes tab-switching (not simultaneous 3 columns) — see 12-EDITOR-UX.md & 15-RESPONSIVE-DESIGN.md.

## Touch Target
- Minimum 44x44px for interactive elements on mobile (buttons, tappable list items) — per common mobile accessibility guidelines.
