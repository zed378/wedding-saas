# 02 - Service Layer

## Service Responsibilities
- Business logic & orchestration (not the Controller, not the Repository).
- Enforcing business rules (PLAN/02-BUSINESS-RULES.md) — e.g., validating state transitions, calculating price server-side, checking ownership.
- Calling repositories for data access, calling other modules' services via their public interfaces, publishing events for async side effects.

## Example: InvitationService.publish()
```
function publish(invitationId, currentUser) {
  const invitation = repository.findOwned(invitationId, currentUser.id);  // authorization built in via the query
  if (!invitation) throw NotFoundError();
  if (invitation.status !== 'paid') throw BusinessRuleError('INVITATION_NOT_PAID');

  const templateVersion = templateService.getVersion(invitation.template_version_id);
  const missingFields = validateRequiredFields(invitation, templateVersion.sections);
  if (missingFields.length > 0) throw ValidationError('INCOMPLETE_DATA', missingFields);

  const slugAvailable = repository.isSlugAvailable(invitation.slug, excludeId=invitationId);
  if (!slugAvailable) throw ConflictError('SLUG_TAKEN');

  db.transaction(() => {
    repository.updateStatus(invitationId, 'published', { published_at: now(), expiry_date: calcExpiry(invitation) });
    statusHistoryRepository.record(invitationId, 'paid', 'published', currentUser.id);
  });

  eventBus.emit('invitation.published', { invitationId });
  return repository.findOwned(invitationId, currentUser.id);
}
```

## Principles
- The Service does NOT know HTTP details (status codes, the request/response object) — that's the Controller's/mapper's responsibility.
- The Service does NOT perform external I/O directly without going through a Port/interface (e.g., `StoragePort`, `PaymentGatewayPort`) — makes testing (mocking) easier & the provider swappable.
- Every business rule from PLAN/02-BUSINESS-RULES.md should be traceable to a specific service (inline documentation/code comments referencing the rule ID, e.g., `// BR-4.2`).

## Dependency Injection
- Services receive their dependencies (repository, other ports) via constructor injection — making unit testing with mocks easier.
