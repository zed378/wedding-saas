# 06 - Design System

## Purpose
The single source of truth for application UI components (NOT the invitation template rendering components, which have a separate library — see FRONTEND/04-TEMPLATE-RENDERING.md). Built as a reusable component library (e.g., based on design tokens + a component library like shadcn/ui or equivalent).

## Design Tokens (details in 08-COLOR-SYSTEM.md, 07-TYPOGRAPHY.md, 09-SPACING-GRID.md)
```
colors: primary, secondary, neutral (50-900), success, warning, danger, info
typography: font-family, scale (xs-4xl), weight (regular/medium/semibold/bold)
spacing: 4px base unit scale (4,8,12,16,24,32,48,64)
radius: sm(4px), md(8px), lg(12px), full
shadow: sm, md, lg
```

## Core Components
| Component | Variants |
|---|---|
| Button | primary, secondary, ghost, danger; size sm/md/lg; loading state |
| Input/Textarea | default, error, disabled; with label & helper text |
| Select/Dropdown | single, searchable |
| Modal/Dialog | confirmation, form, fullscreen (preview) |
| Toast/Notification | success, error, info, warning |
| Card | template card, invitation card, order card |
| Tabs | for editor sub-section navigation |
| Badge | invitation status (draft/paid/published/expired), premium tag |
| Table | order list, RSVP list, guestbook list — with sorting/filtering |
| Stepper/Wizard | for the onboarding flow |
| Skeleton Loader | for all async loading states |
| File Upload/Dropzone | with a progress bar |
| Avatar/Photo Preview | with a crop indicator |

## Usage Rules
- Every component has states: default, hover, focus, active, disabled, loading, error — defined once in the design system, used consistently throughout the app.
- Status colors (invitation badge) are consistent: `draft`=gray, `pending_payment`=yellow, `paid`=blue, `published`=green, `expired`=pink/dark gray.

## Governance
- New/additional components go through a design review first (not created ad-hoc per page) to maintain consistency.
