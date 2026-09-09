# 05 - User Flow (Product-Level Summary)

Detailed visuals & wireframe-level flows are in UI-UX/04-USER-JOURNEYS.md and UI-UX/05-USER-FLOWS.md. This document is a functional cross-system summary.

## Main Flow: Engaged Couple (Happy Path)
```
Landing Page
   ↓
Browse Templates → Template Detail → Select Template
   ↓
Register/Login (if not already)
   ↓
Invitation Setup (slug + internal name)
   ↓
Editor:
   Couple Info → Event Info → Gallery → Maps →
   Wedding Gift → Quote → RSVP config → Guestbook config
   (autosave at each step, not strictly linear, user is free to move between sections)
   ↓
Preview (mobile/desktop)
   ↓
Checkout (choose package + add-ons)
   ↓
Payment (redirect/popup gateway)
   ↓
[Async webhook] Payment confirmed → Invitation status = paid
   ↓
Publish (set final slug, confirm)
   ↓
Share (invitation link, WA/copy button)
```

## Flow: Guest
```
Open invitation link (with/without ?to=Name)
   ↓
Landing section (cover, couple's names, "Open Invitation" button if there's an opening animation)
   ↓
Scroll through active sections (Couple, Event, Countdown, Gallery, Maps, Gift, Quote)
   ↓
RSVP form → submit → confirmation shown
   ↓
Guestbook → write a message → submit → (shown immediately OR "awaiting moderation")
   ↓
Share to other contacts (optional)
```

## Flow: Changing Template After Data Is Filled In
```
Editor → "Change Template" button → Catalog modal
   ↓
Select new template → Confirmation modal ("certain fields may not be displayed")
   ↓
Invitation.template_id is updated → Editor reloads with the new template
   ↓
Old data remains in the DB; unsupported sections are hidden from the preview
```

## Flow: Admin Guestbook Moderation
```
Report received (user report OR automatic from a content filter)
   ↓
Admin Panel → Moderation Queue
   ↓
Review message → Approve/Reject/Delete
   ↓
Audit log recorded
```

## Flow: Renewal
```
H-7 before expiry → Reminder email
   ↓
User clicks "Renew" → Checkout for renewal add-on
   ↓
Payment successful → expiry_date extended, status remains published
```
