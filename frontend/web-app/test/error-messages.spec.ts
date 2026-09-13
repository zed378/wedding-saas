import { describe, expect, it } from "vitest";
import { ApiError } from "@wi/api-client";

import { toFriendlyError } from "../src/lib/error-messages";

/**
 * `P2-14` — the API's generic codes reach the screen in Indonesian.
 *
 * `http/exception.filter.ts` gives them English default messages, and without a mapping the
 * text went straight to the user: the change-template dialog read "The requested resource was
 * not found." in an otherwise Indonesian product.
 */
describe("toFriendlyError for the API's generic codes", () => {
  it.each([
    ["NOT_FOUND", 404, "The requested resource was not found."],
    ["FORBIDDEN", 403, "You do not have permission to perform this action."],
    ["CONFLICT", 409, "The request conflicts with the current state."],
    ["PAYLOAD_TOO_LARGE", 413, "The request body is too large."],
    ["INTERNAL_ERROR", 500, "Internal server error."],
  ])("never shows the English default for %s", (code, status, english) => {
    const friendly = toFriendlyError(
      new ApiError({ status, code, message: english }),
    );

    expect(friendly.message).not.toBe(english);
    // English function words only: "server" is Indonesian too ("di server kami").
    expect(friendly.message).not.toMatch(
      /\b(the|request|resource|permission)\b/i,
    );
  });
});
