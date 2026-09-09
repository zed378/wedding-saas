# Phase N — Completion Summary

| | |
|---|---|
| **Phase** | Phase N — <name> |
| **Started** | YYYY-MM-DD |
| **Completed** | YYYY-MM-DD |
| **Tasks completed** | n / m |
| **Release tag** | |

---

## What Shipped

The capabilities that now exist and did not before, described in terms a stakeholder would recognize rather than in task IDs.

## Acceptance Criteria Verification

Every criterion from `docs/PLAN/17-ACCEPTANCE-CRITERIA.md` and `docs/UI-UX/18-UX-ACCEPTANCE-CRITERIA.md` relevant to this phase, with the evidence that satisfies it. "Evidence" means a test name, a measurement, a report, or a recorded walkthrough — not an assertion that it works.

| Criterion | Evidence | Verified |
|---|---|---|
| | | |

## Security Verification

| Category | Method | Result |
|---|---|---|
| Multi-tenancy / IDOR (`docs/SECURITY/05`) | | |
| Payment (`docs/SECURITY/07`) | | |
| File upload (`docs/SECURITY/06`) | | |
| Input handling / XSS (`docs/SECURITY/08`) | | |
| Abuse prevention (`docs/SECURITY/10`) | | |

Attach the IDOR matrix for any phase that added `:id` endpoints. `docs/SECURITY/11` § Pass Criteria makes multi-tenancy findings unwaivable, so this section is where that is demonstrated rather than claimed.

## Performance Results

Measurements against `docs/PLAN/17` and `docs/FRONTEND/09`, with the conditions they were taken under. A number without its conditions is not a measurement.

| Surface | Target | Measured | Conditions | Met |
|---|---|---|---|---|
| | | | | |

## Deviations from `docs/`

Every deviation during this phase, with its ADR, and whether the affected document has been amended.

| Deviation | ADR | Document amended |
|---|---|---|
| | | |

## Deferred Out of This Phase

What was planned for this phase and did not ship, why, and where it now lives — a `TASKS/BACKLOG.md` entry, or a later phase.

## What Was Harder Than Expected

The tasks that took materially longer than their size suggested, and why. This is what makes the next phase's estimates less wrong.

## What Was Easier Than Expected

Equally useful, and equally likely to be omitted.

## Risks Identified

New entries for `docs/PLAN/18-RISK-REGISTER.md`, or existing ones whose likelihood or impact changed during this phase. `docs/PLAN/18` § Review Cadence requires this review at the end of every phase.

## Readiness for the Next Phase

Whether the next phase's entry gate is satisfied, which open questions in `TASKS/BACKLOG.md` must be answered before it starts, and anything the next phase should know before it begins.
