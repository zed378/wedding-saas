# 02 - Information Architecture

## Sitemap (Authenticated App)
```
/                          Landing/Marketing
/templates                 Template catalog
/templates/:slug           Template detail
/login, /register           Auth
/dashboard                   List of the user's invitations
/dashboard/new                New invitation wizard
/editor/:invitationId          Editor (nested: /couple, /events, /gallery, /maps, /gift, /quote, /rsvp-settings, /guestbook-settings)
/editor/:invitationId/preview   Fullscreen preview
/checkout/:invitationId          Checkout & payment
/orders                            Order history
/orders/:orderId                    Order/invoice detail
/settings/account                    Profile & preferences
```

## Sitemap (Public Invitation)
```
{slug}.maindomain.com/            Main invitation page (all sections in one scroll)
{slug}.maindomain.com/?to=Name     Guest name personalization
```

## Sitemap (Admin Panel — separate subdomain)
```
admin.maindomain.com/dashboard
admin.maindomain.com/users
admin.maindomain.com/templates
admin.maindomain.com/templates/:id/versions/:vid/edit
admin.maindomain.com/orders
admin.maindomain.com/moderation
admin.maindomain.com/audit-logs
```

## Main Navigation (Authenticated App)
- Sidebar/topbar: Dashboard, Templates, Orders, Account.
- Inside the Editor: the section-list sidebar temporarily replaces main navigation (focus mode), with an "Exit Editor" button to return to the Dashboard.

## IA Principles
- The Editor is its own "mode" (full focus), not a regular page within general navigation — reducing distraction while editing.
- The public invitation has NO application navigation at all (a single scrolling page, purely content) — see 14-PUBLIC-INVITATION-UX.md.
