import { logSecurityEvent } from "../../../shared/logging/logger";
import { checkBreached, type BreachCheckOptions } from "./breach-check";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password.params";

/**
 * P1-01 — the password policy, enforced server-side.
 *
 * `docs/SECURITY/03` § Password gives three rules and a recommendation. The fourth rule
 * here — a password must not be the user's own email or name — is not in the document
 * and is added deliberately: it is the single commonest weak password, it costs one
 * comparison, and no breach list contains it because it is unique to that person.
 *
 * Messages are Indonesian and final. `docs/BACKEND/03` § Error Messages: `details[]`
 * entries are "clear enough to display directly to the user without needing additional
 * mapping on the frontend".
 */

export interface PolicyViolation {
  /** Always `password`. `docs/API/00`'s `details[]` shape. */
  readonly field: "password";
  readonly message: string;
  /** Machine-readable, for tests and metrics. Never shown to a user. */
  readonly rule: "too_short" | "too_long" | "breached" | "resembles_identity";
}

export interface PolicyContext {
  /** Checked against the password. Optional: a password change may not have it to hand. */
  readonly email?: string | undefined;
  readonly fullName?: string | undefined;
}

export interface PolicyOptions extends BreachCheckOptions {
  /**
   * Skip the network check.
   *
   * For tests and for the seed. NOT a way to turn the policy off in production -- the
   * length and identity rules run regardless.
   */
  readonly skipBreachCheck?: boolean;
}

/**
 * Check a password against the policy. Returns every violation, not the first.
 *
 * Same reasoning as `loadEnv` and `validateTemplateVersion`: a user fixing one rule per
 * round trip gives up, and "your password is too short" followed by "your password is
 * in a breach list" is two round trips for one decision.
 *
 * **The password is never logged, never returned, and never put in a message.** Not even
 * to say which rule it broke.
 */
export async function checkPasswordPolicy(
  plain: string,
  context: PolicyContext = {},
  options: PolicyOptions = {},
): Promise<PolicyViolation[]> {
  const violations: PolicyViolation[] = [];

  // Length is measured in code points, not UTF-16 units. "😀" repeated eight times is
  // eight characters to a user and sixteen to `String.length`, and telling someone
  // their eight-character password is too short would be both wrong and baffling.
  const length = [...plain].length;

  if (length < MIN_PASSWORD_LENGTH) {
    violations.push({
      field: "password",
      rule: "too_short",
      message: `Kata sandi minimal ${MIN_PASSWORD_LENGTH} karakter.`,
    });
  }

  if (length > MAX_PASSWORD_LENGTH) {
    violations.push({
      field: "password",
      rule: "too_long",
      message: `Kata sandi maksimal ${MAX_PASSWORD_LENGTH} karakter.`,
    });
  }

  if (resemblesIdentity(plain, context)) {
    violations.push({
      field: "password",
      rule: "resembles_identity",
      message: "Kata sandi tidak boleh menyerupai nama atau alamat email Anda.",
    });
  }

  // Only worth asking a third party about a password that could still be accepted.
  if (violations.length === 0 && options.skipBreachCheck !== true) {
    const result = await checkBreached(plain, options);

    if (result.status === "breached") {
      violations.push({
        field: "password",
        rule: "breached",
        // The count is deliberately NOT shown. "Found in 3,861,493 breaches" invites
        // the reader to treat a smaller number as acceptable.
        message:
          "Kata sandi ini pernah bocor dalam kebocoran data. Gunakan kata sandi lain.",
      });
    }

    if (result.status === "unavailable") {
      // ADR-044: fail open, but never silently. This is the event that makes the gap
      // visible; without it the control could be down for a month unnoticed.
      logSecurityEvent(
        "auth.breach_check_unavailable",
        { reason: result.reason },
        "warn",
      );
    }
  }

  return violations;
}

/**
 * Is the password essentially the user's own name or email?
 *
 * Compared case-insensitively and with separators removed, so `Budi-Santoso` does not
 * pass where `budisantoso` would not. Containment in either direction: a password that
 * contains the name, and a name that contains the password, are both bad.
 */
function resemblesIdentity(plain: string, context: PolicyContext): boolean {
  const normalise = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

  const candidate = normalise(plain);
  if (candidate.length === 0) return false;

  const identities = [
    context.fullName,
    context.email,
    // The local part on its own: `budi@gmail.com` -> `budi`. People use it far more
    // often than the whole address.
    context.email?.split("@")[0],
  ]
    .filter((v): v is string => v !== undefined && v.length > 0)
    .map(normalise)
    // A two-letter name would match almost everything.
    .filter((v) => v.length >= 4);

  return identities.some(
    (identity) => candidate.includes(identity) || identity.includes(candidate),
  );
}
