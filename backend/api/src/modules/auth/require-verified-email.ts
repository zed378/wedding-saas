import { ForbiddenError } from "../../http/errors";

/**
 * P1-02 step 5 — the publish/checkout gate.
 *
 * `docs/API/01` step 2: an unverified user may create and edit drafts; publish and
 * checkout are refused.
 *
 * ## Why this is a function and not a middleware
 *
 * The card is explicit -- "in the **publish and order services**, not in a middleware
 * that could be forgotten" -- and the reasoning is worth keeping beside the code.
 *
 * A route-level guard has to be remembered on every new route. The routes that need it
 * are a tiny minority (two), and the routes that must NOT have it are everything the
 * editor calls. So the default has to be "no gate", which means the gate is opt-in,
 * which means it is forgettable exactly where it matters.
 *
 * Calling it from the service puts it next to the effect it protects. `POST /publish`
 * can grow a second caller -- an admin path, a scheduled republish -- and a middleware
 * would guard the HTTP route while the service stayed open.
 */
export function requireVerifiedEmail(user: {
  readonly emailVerified: boolean;
}): void {
  if (user.emailVerified) return;

  // 403, not 404: this reveals nothing about anyone else's resources. It is a property
  // of the CALLER, which docs/API/00 § 403 vs 404 names as the legitimate use of 403.
  throw new ForbiddenError("EMAIL_NOT_VERIFIED");
}
