import { describe, expect, it } from "vitest";

import { PublicInvitationService } from "../src/modules/publishing/public-invitation.service";
import type { PublicInvitationRepository } from "../src/shared/tenancy/public-invitation-repository";
import type { Env } from "../src/config/env.schema";
import { rejection } from "./support/rejection";

/**
 * `P2-07` — the half of the service that HTTP cannot see.
 *
 * `docs/BACKEND/06` § Slug Resolution: *"Normalize and validate the slug shape BEFORE
 * querying (a path segment is untrusted input …)"*. Over the wire that rule is invisible:
 * an invalid slug finds no row and answers 404 either way, so the integration suite
 * passes with the check deleted — which is exactly what a mutation run showed.
 *
 * The observable difference is that **no query happens**, which matters for the one thing
 * the check is for: somebody walking the address space costs a database round trip per
 * guess otherwise, on the product's only unauthenticated endpoint.
 *
 * So the repository here refuses to be called. A test that asserts an absence has to have
 * something that would notice the presence.
 */

const env = { CDN_BASE_URL: "https://cdn.test" } as Env;

function serviceThatMustNotQuery(): PublicInvitationService {
  const repository = {
    findPublishedBySlug: () => {
      throw new Error(
        "the repository was queried for a slug that cannot be valid",
      );
    },
  } as unknown as PublicInvitationRepository;

  return new PublicInvitationService(repository, env);
}

describe("the slug is validated before anything is queried", () => {
  it.each([
    ["too short", "ab"],
    ["too long", "a".repeat(51)],
    ["a leading hyphen", "-andi"],
    ["a trailing hyphen", "andi-"],
    ["an underscore", "andi_sarah"],
    ["a slash", "andi/sarah"],
    ["a space", "andi sarah"],
    ["empty", ""],
    // Uppercase is deliberately NOT here. The service normalizes before it validates, so
    // `Andi-Sarah` is a valid address typed in the wrong case rather than an invalid one
    // -- it reaches the repository, and the next test is what pins that.
  ])("answers 404 for %s without a round trip", async (_label, slug) => {
    const service = serviceThatMustNotQuery();

    await expect(service.bySlug(slug)).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it("lowercases and trims before deciding", async () => {
    // A path segment arrives as typed. `ANDI-SARAH` is a valid address in the wrong case
    // rather than an invalid one, and the resolution `docs/BACKEND/06` asks for is to
    // normalize first -- so this one MUST reach the repository.
    let asked: string | undefined;
    const repository = {
      findPublishedBySlug: (slug: string) => {
        asked = slug;
        return Promise.resolve(null);
      },
    } as unknown as PublicInvitationRepository;

    const service = new PublicInvitationService(repository, env);

    await expect(service.bySlug("  ANDI-SARAH  ")).rejects.toMatchObject({
      status: 404,
    });
    expect(asked).toBe("andi-sarah");
  });

  it("gives a not-found slug and an invalid slug the same error", async () => {
    // The two paths construct the 404 in different places in the service, which is
    // exactly the kind of split that drifts by a word -- and one word is enough to tell
    // somebody which slugs exist.
    const missing = {
      findPublishedBySlug: () => Promise.resolve(null),
    } as unknown as PublicInvitationRepository;

    const fromMissing = await rejection(() =>
      new PublicInvitationService(missing, env).bySlug("andi-sarah"),
    );
    const fromInvalid = await rejection(() =>
      serviceThatMustNotQuery().bySlug("A"),
    );

    expect(fromInvalid.code).toBe(fromMissing.code);
    expect(fromInvalid.message).toBe(fromMissing.message);
  });
});
