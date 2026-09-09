# 04 - Security Testing (Execution Detail)

A complement to SECURITY/11-SECURITY-TESTING.md — this document focuses on HOW the testing team concretely executes it.

## IDOR/Multi-Tenancy Sweep (Top Priority)
Methodology:
```
1. Prepare 2 user accounts (A and B), each with 1 complete invitation (data, media, an order).
2. For EVERY endpoint in API/04 through API/07 that accepts a path parameter `:id` or similar:
   a. Log in as B.
   b. Send a request to that endpoint with an `:id` belonging to A (invitation_id, media_id, order_id, event_id, etc.).
   c. Verify the response is 404 (not A's data leaking, and not a 403 that confirms the resource's existence — see SECURITY/04).
3. Repeat for GET, PATCH, DELETE operations, and nested sub-resources (e.g., gallery/:photo_id within an invitation).
4. Document the results per endpoint in a matrix (endpoint × pass/fail result).
```

## Payment Tampering Test
```
1. Initiate a normal payment.
2. Attempt manipulation: manually change the redirect URL's query parameter to a success status in the browser → verify the Order/Invitation status in the backend does NOT change (should remain pending until a valid webhook is received).
3. Send a POST directly to the webhook endpoint with a "success" payload but a spoofed/empty signature → verify it's rejected with a 401, state unchanged.
4. Send a valid webhook twice (a replay) → verify the effect only happens once (idempotency).
```

## File Upload Test
```
1. Upload a .php file renamed to .jpg → verify it's rejected (the magic-byte check).
2. Upload a file exceeding the size limit → verify it's rejected before the full upload completes (if testable).
3. Upload an image with extreme dimensions (e.g., 20000x20000px) → verify it's rejected/doesn't cause resource exhaustion on the worker.
4. Upload an image with GPS EXIF data → verify the final stored file no longer has that EXIF data.
```

## XSS Test
```
For every free-text field (name, quote, guestbook message, RSVP message):
1. Submit a payload like a script tag or an HTML event-handler attribute.
2. Verify the field is stored in its sanitized form (not verbatim).
3. Open the public page displaying that field → verify no script execution occurs (checked via browser devtools/an automated XSS scanner).
```

## Report & Follow-up
- Every finding is logged with a severity (Critical/High/Medium/Low), reproduction steps, and remediation status — tracked until closed before release (for Critical/High categories, per SECURITY/11 § Pass Criteria).
