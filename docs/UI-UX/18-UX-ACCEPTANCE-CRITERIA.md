# 18 - UX Acceptance Criteria

Qualitative & measurable criteria for design/UX sign-off before it's considered release-ready, complementing PLAN/17-ACCEPTANCE-CRITERIA.md.

## Editor
- [ ] A new user can complete filling in core data (couple, at least 1 event, at least 1 photo) without external help in a usability test (5 participants, task completion > 80% without confusion).
- [ ] Autosave status is always visible & understood by the user (test: ask participants "are you confident your data was saved?" — a positive answer).
- [ ] No data is lost when switching between sections repeatedly (automated regression test).

## Checkout & Payment
- [ ] The user clearly understands which package they are paying for & the total before clicking pay (comprehension test).
- [ ] Payment status (pending/success/failed) is never ambiguous in the UI.

## Public Page
- [ ] A general guest (the Mrs. Ratna persona) can find the date, location, and how to RSVP without confusion in a usability test.
- [ ] Visible main content render time < 2 seconds in a simulated 4G environment (not a blank screen).

## Accessibility
- [ ] Passes an automated audit (axe-core) with no critical errors on: Editor, Checkout, Public Invitation, RSVP form pages.
- [ ] Keyboard-only navigation successfully completes the checkout flow end-to-end.

## Design Consistency
- [ ] Design-to-implementation review (design QA) is performed for all key pages before release — no significant deviation from the design system (06-DESIGN-SYSTEM.md) without justification.

## Sign-off
Requires approval from the Product Designer + Product Owner, separate from the technical sign-off in PLAN/17.
