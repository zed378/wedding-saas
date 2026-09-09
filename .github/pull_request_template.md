<!--
  Every field below is required. They exist because this project is built across many
  sessions by different people and agents, and a PR that does not say what it implements
  is a PR nobody can review against the specification.
  Conventions: TASKS/00-TASK-CONVENTIONS.md
-->

## Task

<!-- The task ID from TASKS/, e.g. P1-09. One task per PR wherever possible. -->

Task ID:

## Specification implemented

<!-- The docs/ sections this implements. Not "the API doc" — the section.
     e.g. docs/API/04-INVITATION-API.md § Sub-resource: Events -->

-

## Tests

<!-- Which layers were added and actually run. "Ran locally" is a claim; name the tests. -->

| Layer       | Added | Run |
| ----------- | ----- | --- |
| Unit        |       |     |
| Integration |       |     |
| E2E         |       |     |
| Security    |       |     |

## Security review flag

<!-- Tick every area this PR touches. Any tick means it needs a second pair of eyes
     on the security aspect specifically (TASKS/00-TASK-CONVENTIONS.md). -->

- [ ] Authorization or ownership logic
- [ ] Payment initiation, webhooks, or pricing
- [ ] File upload or media processing
- [ ] Input sanitization or output encoding
- [ ] Anything served under `/public/*`
- [ ] None of the above

## New `:id` endpoints

<!-- docs/SECURITY/05 is the project's first priority and has zero tolerance.
     If this PR adds an endpoint taking a resource id, name the IDOR test that proves
     a non-owner receives 404 with no data. If it adds none, say "none". -->

IDOR test:

## Deviation from `docs/`

<!-- Did anything land differently from what the specification says?
     If yes: link the ADR in MEMORY/DECISIONS.md and the amended document.
     An undocumented deviation is a bug nobody has found yet. -->

- [ ] None
- [ ] Yes — ADR: <!-- ADR-0xx --> / document amended: <!-- docs/... -->

## MEMORY record

<!-- A task is not DONE until its record exists (global DoD item 10). -->

- [ ] `MEMORY/records/YYYY-MM-DD-<task-id>-<slug>.md` added
- [ ] `MEMORY/MEMORY-INDEX.md` line added
- [ ] `TASKS/PROGRESS.md` and the phase file checkbox updated
