import type { ErrorDetail } from "./envelope";

/**
 * The domain errors services throw, and the only things the exception mapper knows how
 * to translate. `docs/API/00` § HTTP Status Codes.
 *
 * Services throw these rather than returning status codes, because a service is called
 * from HTTP handlers, from jobs, and from other services -- and only one of those has a
 * response to put a number in. The mapping to a status code happens once, at the edge.
 *
 * There is deliberately **no `ForbiddenError` for someone else's resource.** That case
 * is a `NotFoundError`, and the type system is where that rule is easiest to keep: if
 * the class does not exist, nobody can throw it by accident. See `ADR-018` and
 * `docs/API/00` § 403 vs 404.
 */

export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  readonly details?: readonly ErrorDetail[];

  constructor(message: string, details?: readonly ErrorDetail[]) {
    super(message);
    this.name = new.target.name;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** 400. Structural validation failed. `details` names the offending fields. */
export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = "VALIDATION_ERROR";

  constructor(
    details: readonly ErrorDetail[],
    message = "The request could not be validated.",
  ) {
    super(message, details);
  }
}

/**
 * 401. No credentials, or credentials that are not valid.
 *
 * The code is a parameter because `docs/API/01` § Error Cases names a second one,
 * `INVALID_CREDENTIALS`, for a failed login — and only for a failed login. Everything
 * else that is 401 (no token, expired token, forged token, spent refresh token) must stay
 * `UNAUTHENTICATED` and indistinguishable, which is why this is a closed union rather
 * than a free string.
 */
export class UnauthenticatedError extends AppError {
  readonly status = 401;
  readonly code: "UNAUTHENTICATED" | "INVALID_CREDENTIALS";

  constructor(
    message = "Authentication is required.",
    code: "UNAUTHENTICATED" | "INVALID_CREDENTIALS" = "UNAUTHENTICATED",
  ) {
    super(message);
    this.code = code;
  }
}

/**
 * 403. The caller lacks a **kind** of access — a role, or a verified email.
 *
 * Never for another user's resource. `docs/API/00` is explicit: 403 there would confirm
 * the resource exists and turn every `:id` endpoint into an enumeration oracle. The
 * codes below are the only two situations where no resource identity is revealed.
 */
export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code: string;

  constructor(
    code: "FORBIDDEN" | "EMAIL_NOT_VERIFIED" = "FORBIDDEN",
    message?: string,
  ) {
    super(
      message ??
        (code === "EMAIL_NOT_VERIFIED"
          ? "Verify your email address to continue."
          : "You do not have permission to perform this action."),
    );
    this.code = code;
  }
}

/**
 * 404. Not found — **and** the answer for a resource that exists but is not the
 * caller's (ADR-018).
 *
 * The message is deliberately identical in both cases. A different wording would
 * reintroduce exactly the oracle the status code was chosen to remove.
 */
export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = "NOT_FOUND";

  constructor(message = "The requested resource was not found.") {
    super(message);
  }
}

/** 409. A uniqueness conflict — a slug already taken, an active order already open. */
export class ConflictError extends AppError {
  readonly status = 409;
  readonly code: string;

  constructor(
    code = "CONFLICT",
    message = "The request conflicts with the current state.",
  ) {
    super(message);
    this.code = code;
  }
}

/**
 * 422. The request is well-formed and permitted, but a business rule says no —
 * publishing an invitation with incomplete data, for instance.
 *
 * Distinct from 400 on purpose: 400 means "you sent something malformed", 422 means
 * "what you sent is fine but the answer is still no". A client can retry a 400 after
 * fixing the payload; a 422 needs a different action entirely.
 */
export class BusinessRuleError extends AppError {
  readonly status = 422;
  readonly code: string;

  constructor(code: string, message: string, details?: readonly ErrorDetail[]) {
    super(message, details);
    this.code = code;
  }
}

/** 429. `docs/SECURITY/10`. Thrown by the rate limiter in `P1-07`. */
export class RateLimitedError extends AppError {
  readonly status = 429;
  readonly code = "TOO_MANY_ATTEMPTS";

  constructor(message = "Too many requests. Try again shortly.") {
    super(message);
  }
}

/**
 * 503. A dependency this request needed could not be reached.
 *
 * Added by `P1-04` for the case that must not become a 401: Google's key endpoint being
 * unreachable is not a bad credential. Telling a user their sign-in was rejected sends
 * them to a password form for an account that may have no password, and turns an outage
 * somewhere else into what looks like their mistake.
 *
 * The message names the service, never the failure -- `docs/SECURITY/08` § Error Handling
 * forbids leaking the shape of an internal error to a client.
 */
export class ServiceUnavailableError extends AppError {
  readonly status = 503;
  readonly code = "SERVICE_UNAVAILABLE";

  constructor(message = "A required service is temporarily unavailable.") {
    super(message);
  }
}
