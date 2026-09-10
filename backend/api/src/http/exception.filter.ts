import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";

import { failure, type ErrorDetail, type ErrorEnvelope } from "./envelope";
import { AppError } from "./errors";
import { logger } from "../shared/logging/logger";

/**
 * The last thing in the chain. Every error becomes one of the two documented shapes,
 * and nothing internal reaches the client.
 *
 * `docs/SECURITY/08` § Error Handling: no stack trace, no SQL, no server path, no
 * library version — "a generic message to the client, full detail only in server logs".
 *
 * The design rule that keeps that true: the response is built from an **allowlist** of
 * recognised error types. An unrecognised error does not get its message forwarded; it
 * gets a fixed string. That is the difference between a filter that is careful and one
 * that is safe — a Postgres error message contains the failing SQL, and a Node error
 * contains a file path, and neither of those authors was thinking about your API
 * contract.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body, logAs } = translate(exception);

    if (logAs === "error") {
      // The full error, including the stack, goes to the log -- which is redacted by
      // P0-12 and carries the request_id, so it can be found from the client's report.
      logger.error({ err: exception }, "unhandled error");
    } else {
      logger.warn(
        { context: { code: body.error.code, status } },
        "request rejected",
      );
    }

    response.status(status).json(body);
  }
}

interface Translated {
  status: number;
  body: ErrorEnvelope;
  logAs: "warn" | "error";
}

function translate(exception: unknown): Translated {
  // 1. Our own domain errors. These carry a code and a message written FOR a client.
  if (exception instanceof AppError) {
    return {
      status: exception.status,
      body: failure(exception.code, exception.message, exception.details),
      // A 4xx is the client being told no, which is normal traffic and not an alert.
      // A 5xx from our own code should not exist, so it is logged as an error.
      logAs: exception.status >= 500 ? "error" : "warn",
    };
  }

  // 2. Nest's own exceptions -- a 404 from no matching route, a 413 from the body
  //    limit. Their messages are framework strings, safe but unhelpfully shaped, so
  //    only the status is taken and the message is replaced with one of ours.
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return {
      status,
      body: failure(
        codeForStatus(status),
        messageForStatus(status),
        detailsFrom(exception),
      ),
      logAs: status >= 500 ? "error" : "warn",
    };
  }

  // 3. Everything else. A Postgres error, a TypeError, a library throwing a string.
  //    NOTHING from it reaches the client -- not the message, not the name, not the
  //    code. The request_id in the response header is how a user's report gets
  //    connected to the logged detail.
  return {
    status: 500,
    body: failure("INTERNAL_ERROR", "Something went wrong. Please try again."),
    logAs: "error",
  };
}

/**
 * Nest packs validation messages into the exception response. Pull them out only when
 * they are already in our `{field, message}` shape -- anything else is dropped rather
 * than guessed at, because a malformed detail array is worse than none.
 */
function detailsFrom(
  exception: HttpException,
): readonly ErrorDetail[] | undefined {
  const payload = exception.getResponse();
  if (typeof payload !== "object" || payload === null) return undefined;

  const details = (payload as { details?: unknown }).details;
  if (!Array.isArray(details)) return undefined;

  const clean = details.filter(
    (d): d is ErrorDetail =>
      typeof d === "object" &&
      d !== null &&
      typeof (d as ErrorDetail).field === "string" &&
      typeof (d as ErrorDetail).message === "string",
  );

  return clean.length > 0 ? clean : undefined;
}

/** Codes for statuses Nest raises itself. Aligned with `docs/API/00`. */
function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "VALIDATION_ERROR";
    case 401:
      return "UNAUTHENTICATED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 405:
      return "METHOD_NOT_ALLOWED";
    case 409:
      return "CONFLICT";
    case 413:
      return "PAYLOAD_TOO_LARGE";
    case 415:
      return "UNSUPPORTED_MEDIA_TYPE";
    case 422:
      return "UNPROCESSABLE";
    case 429:
      return "TOO_MANY_ATTEMPTS";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST";
  }
}

/**
 * Client-facing messages. Written here rather than taken from the framework so that
 * every one of them has been read by someone with the API contract in mind.
 */
function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "The request could not be validated.";
    case 401:
      return "Authentication is required.";
    case 403:
      return "You do not have permission to perform this action.";
    case 404:
      // Identical to NotFoundError's message. A different wording for "no such route"
      // versus "not yours" would reintroduce the enumeration oracle that ADR-018
      // removed, through the back door of a helpful error message.
      return "The requested resource was not found.";
    case 405:
      return "That method is not supported for this endpoint.";
    case 409:
      return "The request conflicts with the current state.";
    case 413:
      return "The request body is too large.";
    case 415:
      return "That content type is not supported.";
    case 422:
      return "The request could not be processed.";
    case 429:
      return "Too many requests. Try again shortly.";
    default:
      return status >= 500
        ? "Something went wrong. Please try again."
        : "The request could not be processed.";
  }
}
