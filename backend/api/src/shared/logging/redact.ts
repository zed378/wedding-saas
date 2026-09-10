/**
 * Redaction, keyed on field NAME, at any depth.
 *
 * `docs/DEVOPS/06` § Mandatory Redaction is explicit that this happens "at the logger
 * middleware level, not relying on manual developer discipline each time". That wording
 * is the whole design constraint: a rule people have to remember is a rule that holds
 * until the first 2am incident, when someone logs the whole request object to work out
 * what is going on — and that is precisely the moment the log is most likely to be read
 * by the most people.
 *
 * So the redactor is not a list of paths. Pino's built-in `redact` takes paths like
 * `req.body.password`, which means every new shape needs a new entry and a nested or
 * renamed field slips through silently. This walks the object and decides by key name,
 * so a password is redacted wherever it appears and whatever wraps it.
 *
 * The trade is false positives: a field innocently called `token` gets `[REDACTED]`
 * even when it holds nothing sensitive. That is the right direction to be wrong in.
 */

export const REDACTED = "[REDACTED]";

/**
 * Key names whose values never appear in a log.
 *
 * Matched case-insensitively against the key with `_`, `-` and spaces removed, so
 * `access_token`, `accessToken`, `Access-Token` and `ACCESSTOKEN` are all the same key.
 */
const SECRET_KEYS = new Set([
  // Credentials
  "password",
  "passwordhash",
  "currentpassword",
  "newpassword",
  "passwordconfirmation",
  "secret",
  "clientsecret",
  "signingkey",
  "pepper",
  "refreshtokenpepper",
  "jwtsigningkey",
  // Tokens of every kind. docs/DEVOPS/06 names access, refresh, API key and
  // signature secret; the set is deliberately wider than the list.
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "tokenhash",
  "apikey",
  "apisecret",
  "authorization",
  "cookie",
  "setcookie",
  "sessionid",
  "codehash",
  "secretencrypted",
  "recoverycode",
  // Provider signatures. A leaked signature header lets a forged callback be replayed.
  "signature",
  "xsignature",
  "signaturekey",
  "midtranssignaturekey",
  "serverkey",
  "midtransserverkey",
  "webhooksecret",
  "midtranswebhooksecret",
  "resendapikey",
  // The full provider payload. docs/DEVOPS/06: keep the complete version only in
  // payments.raw_callback_payload, which has restricted access, never in a log that
  // may have broader access and a longer retention.
  "rawcallbackpayload",
  // Connection strings carry a password.
  "databaseurl",
  "migrationdatabaseurl",
  "redisurl",
  "storagesecretaccesskey",
  "storageaccesskeyid",
]);

/** Keys that are masked rather than removed, because a suffix is useful in support. */
const MASKED_KEYS = new Set(["accountnumber", "account_number"]);

/** Keys holding an email address. Partially masked -- docs/DEVOPS/06 § Redaction. */
const EMAIL_KEYS = new Set([
  "email",
  "useremail",
  "owneremail",
  "recipient",
  "to",
]);

function normalise(key: string): string {
  return key.replace(/[_\-\s]/g, "").toLowerCase();
}

/**
 * Mask all but the last four characters. `1234567890` becomes `******7890`.
 *
 * `invitation_bank_accounts.account_number` is not a platform credential (ADR-025) --
 * the couple publishes it deliberately. It is masked here anyway because a log is a
 * different audience from an invitation page, and `docs/DEVOPS/06` asks for it.
 */
export function maskTail(value: string, visible = 4): string {
  if (value.length <= visible) return "*".repeat(value.length);
  return "*".repeat(value.length - visible) + value.slice(-visible);
}

/** `alice@example.com` becomes `a***e@example.com`. Enough to correlate, not to spam. */
export function maskEmail(value: string): string {
  const at = value.lastIndexOf("@");
  if (at <= 0) return maskTail(value, 2);
  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (local.length <= 2) return `${"*".repeat(local.length)}${domain}`;
  return `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}${domain}`;
}

/**
 * Anything that looks like a bearer token or a long opaque string in a *value*, even
 * when its key is innocent. Catches `{ note: "Authorization: Bearer eyJhb..." }`.
 */
const BEARER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT = /\beyJ[A-Za-z0-9._-]{20,}/g;

function scrubString(value: string): string {
  return value.replace(BEARER, "$1 " + REDACTED).replace(JWT, REDACTED);
}

const MAX_DEPTH = 8;
const MAX_ARRAY = 100;

/**
 * Return a copy of `input` safe to serialise into a log line.
 *
 * Bounded on purpose. A deeply nested or enormous object should degrade to a marker
 * rather than stall the process or produce a megabyte log line — logging must never be
 * the thing that takes the service down.
 *
 * Cycle-safe: a request object holding a reference to its own socket is normal, and an
 * unguarded walk would recurse forever.
 */
export function redact(
  input: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (input === null || input === undefined) return input;

  if (typeof input === "string") return scrubString(input);

  if (typeof input !== "object") {
    // number, boolean, bigint, symbol, function
    return typeof input === "bigint" ? input.toString() : input;
  }

  if (depth >= MAX_DEPTH) return "[Object depth limit]";

  if (seen.has(input)) return "[Circular]";
  seen.add(input);

  if (input instanceof Error) {
    return {
      name: input.name,
      message: scrubString(input.message),
      stack: input.stack,
    };
  }

  if (input instanceof Date) return input.toISOString();
  if (Buffer.isBuffer(input)) return `[Buffer ${input.length} bytes]`;

  if (Array.isArray(input)) {
    const trimmed = input
      .slice(0, MAX_ARRAY)
      .map((v) => redact(v, depth + 1, seen));
    if (input.length > MAX_ARRAY)
      trimmed.push(`[${input.length - MAX_ARRAY} more]`);
    return trimmed;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const k = normalise(key);

    if (SECRET_KEYS.has(k)) {
      // Removed entirely rather than masked: for a token, even a suffix narrows a
      // brute force, and there is no debugging question a partial token answers.
      out[key] = REDACTED;
      continue;
    }

    if (MASKED_KEYS.has(k)) {
      out[key] = typeof value === "string" ? maskTail(value) : REDACTED;
      continue;
    }

    if (EMAIL_KEYS.has(k)) {
      out[key] =
        typeof value === "string"
          ? maskEmail(value)
          : redact(value, depth + 1, seen);
      continue;
    }

    out[key] = redact(value, depth + 1, seen);
  }

  return out;
}

/** The key names this redactor removes. Exported so tests can assert against the source. */
export const REDACTED_KEY_NAMES: readonly string[] = [...SECRET_KEYS];
export const MASKED_KEY_NAMES: readonly string[] = [...MASKED_KEYS];
export const EMAIL_KEY_NAMES: readonly string[] = [...EMAIL_KEYS];
