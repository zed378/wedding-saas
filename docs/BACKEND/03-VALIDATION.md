# 03 - Validation

## Two Validation Layers
1. **Structural validation** (Controller layer) — shape, data type, format, string length, required-at-the-request-level. Failure → 400 `VALIDATION_ERROR`.
2. **Business validation** (Service layer) — depends on other state (e.g., "required field for publishing" depends on the active template, "slug availability" depends on other DB data). Failure → 422 `BUSINESS_RULE_ERROR` or 409 `CONFLICT`.

## Example Structural Schema (per sub-resource)
```ts
const EventSchema = z.object({
  type: z.enum(['akad','reception','custom']),
  title: z.string().min(1).max(150),
  event_date: z.string().date(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  venue_name: z.string().min(1).max(200),
  address: z.string().min(1).max(2000),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  description: z.string().max(2000).optional(),
});
```

## Field Whitelisting (Mass Assignment Prevention)
- The validation schema doubles as a whitelist — a field not defined in the schema is AUTOMATICALLY rejected/stripped (`.strict()` mode in Zod or equivalent), never passed raw through to the database (SECURITY/08).

## Free-Text Input Sanitization
- All free-text string fields (name, quote, guestbook message, RSVP message) go through an HTML sanitizer (stripping dangerous tags) AFTER shape validation, BEFORE saving — run as a separate, explicit middleware/step so it's never accidentally skipped.

## Validating Completeness for Publishing
```
function validateRequiredFields(invitationData, templateSections) {
  const missing = [];
  for (const section of templateSections) {
    if (!isSectionEnabled(section, invitationData.settings)) continue;
    for (const fieldPath of section.required_fields) {
      if (isEmpty(resolvePath(invitationData, fieldPath))) missing.push(fieldPath);
    }
  }
  return missing; // used in InvitationService.publish(), see BACKEND/02
}
```

## File Upload Validation
- Separate from regular JSON body validation — see SECURITY/06-FILE-UPLOAD-SECURITY.md and BACKEND/04-FILE-PROCESSING.md for the full pipeline.

## Error Messages
- `details[]` in the response (API/00) contains `{ field, message }` per failing field — messages in Indonesian, clear enough to display directly to the user without needing additional mapping on the frontend.
