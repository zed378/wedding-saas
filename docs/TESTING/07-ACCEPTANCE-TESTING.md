# 07 - Acceptance Testing (UAT)

## Purpose
Final verification that the product meets real business & user needs before release — complementing (not replacing) the automated testing in the other TESTING/ documents.

## UAT Process
```
1. Deploy the release candidate build to staging (representative data, not super-minimal dummy data).
2. Distribute a scenario checklist to the internal team (the Product Owner, at least 1 non-technical person) — use the product as a real user would.
3. Collect findings (bugs, confusing UX, requirement mismatches) within a scheduled period (e.g., 2-3 days).
4. Triage findings: a blocker (must be fixed before release) vs. non-blocker (goes to the backlog).
5. Formal sign-off from the Product Owner after blockers are resolved.
```

## Representative UAT Scenarios (Examples)
- As a new engaged couple: create an invitation from scratch to publishing, without any technical documentation help — is the flow intuitive?
- As a WO: manage 3 different invitations for different clients — is the dashboard clearly distinguishing between them?
- As a general guest (simulate with an actual non-technical person if possible): open the link, RSVP, send a message — how quickly do they understand what to do?
- As an admin: moderate reported content, process a refund — is the process clear enough & safe from accidental clicks?

## Sign-off Criteria
Refers directly to:
- PLAN/17-ACCEPTANCE-CRITERIA.md (measurable technical & functional criteria).
- UI-UX/18-UX-ACCEPTANCE-CRITERIA.md (UX criteria).

## Result Documentation
- Every UAT session produces a brief report: scenarios tested, findings, resolution status, date & sign-off signature — stored as part of the release record (aligned with SECURITY/11 § Result Documentation for security testing).

## Ongoing UAT (Post-MVP)
- For the next major feature release (custom domain, etc. — PLAN/16 Phase 7), the same UAT process is repeated at a smaller scale appropriate to that feature's scope.
