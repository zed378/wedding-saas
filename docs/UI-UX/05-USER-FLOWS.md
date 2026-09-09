# 05 - User Flows (Wireframe-Level Detail)

Complements PLAN/05-USER-FLOW.md with screen & state detail per step.

## Flow: Onboarding → Editor (Detail)
```
[Landing] --click "Start Creating an Invitation"--> [Template Catalog]
[Template Catalog] --click a card--> [Template Detail modal/page]
[Template Detail] --click "Use This Template"--> 
   IF not logged in: [Register/Login Modal] --success--> continue
   [Wizard Step: Internal Name + Initial Slug] --submit--> [Editor: Couple section active by default]
```

## Flow: Editor — Section Interaction (Gallery example)
```
[Editor - Section List] --click "Gallery"--> [Properties Panel: Gallery]
   --click "Add Photo"--> [File Picker / Drag-drop area]
   --upload succeeds--> [A thumbnail appears in the grid, the center preview updates automatically]
   --drag to reorder--> [Order saved automatically (debounced)]
   --click a photo--> [Options: set as cover / delete / edit caption]
```

## Flow: Checkout (Detail State)
```
[Editor] --click "Publish" (main button)--> 
   IF the invitation is incomplete: [Modal listing the missing fields] --user completes them--> retry
   IF complete & not yet paid: [Checkout page]
[Checkout] --selects a package--> [Price summary updates live]
[Checkout] --clicks "Pay"--> [Redirect/embed Payment Gateway]
[Payment Gateway] --user finishes paying--> [Redirect to /orders/:id?returning=true]
[/orders/:id] --on mount: polls status from the server--> 
   IF status is still pending: [Show "Waiting for payment confirmation..." + auto-retry poll]
   IF status is paid: [Show success + a "Continue to Publish" button]
```

## Flow: Public RSVP (Detail State)
```
[Invitation Page] --scroll to the RSVP section--> [Form: Name, Attendance Status, Guest Count, Message]
--click "Submit"--> [Button loading state]
   IF successful: [The form is replaced with "Thank you for confirming!"]
   IF failed (rate-limit/validation): [Inline error message, the form remains filled in (not reset)]
```

## Flow: Changing Template (Detail with Confirmation)
```
[Editor] --click "Change Template"--> [Compact Catalog Modal]
--selects a new template--> [Confirmation Modal: "X fields may not be displayed in this template" (fields listed)]
--confirms--> [Loading: applying the new template]
--complete--> [Editor reloads with the new template preview, old data remains]
```
