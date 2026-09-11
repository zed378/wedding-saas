import { createHash } from "node:crypto";

/**
 * P1-01 — the breached-password check, and what happens when it cannot run.
 *
 * `docs/SECURITY/03` § Password: a minimum of 8 characters "checked against a list of
 * common/breached passwords (e.g., via the haveibeenpwned k-anonymity API) is
 * recommended".
 *
 * ## The password never leaves the process
 *
 * k-anonymity means the client sends the **first five hex characters of the SHA-1** of
 * the password and receives every suffix that shares that prefix — typically several
 * hundred — then searches locally. The service learns a bucket containing roughly
 * one in a million of all known hashes and cannot tell which one was asked about.
 *
 * That is worth stating plainly because "we send your password to a third party" is the
 * reasonable objection this design exists to answer, and a reader who does not know the
 * scheme will assume the obvious implementation.
 *
 * SHA-1 is not a security choice here. It is the index HIBP publishes; the password is
 * never stored under it.
 *
 * ## The failure mode — ADR-044
 *
 * `P1-01` step 4 requires this to be decided and recorded rather than defaulted into.
 * When the API is unreachable, slow, or answers with something unparseable, this
 * **fails open**: the password is accepted, and the caller emits a security event.
 *
 * Failing closed would block a couple from registering during someone else's outage,
 * for a control `docs/SECURITY/03` calls *recommended* — while the controls it calls
 * mandatory (minimum length, and `P1-07`'s rate limiting) still hold. Failing open
 * *silently* would be the wrong half of that trade, and is why `checkBreached` reports
 * `unavailable` as a distinct answer rather than folding it into "not breached".
 */

export type BreachResult =
  | { readonly status: "breached"; readonly count: number }
  | { readonly status: "safe" }
  /** The check could not run. The caller decides; see ADR-044. */
  | { readonly status: "unavailable"; readonly reason: string };

export interface BreachCheckOptions {
  /** Injected so tests never reach the network. */
  readonly fetch?: typeof globalThis.fetch;
  /** Short: this sits on the registration path and a slow third party must not own it. */
  readonly timeoutMs?: number;
  readonly endpoint?: string;
}

const DEFAULT_ENDPOINT = "https://api.pwnedpasswords.com/range";
const DEFAULT_TIMEOUT_MS = 2000;

/**
 * The SHA-1 prefix and suffix of a password, uppercase hex.
 *
 * Exported so a test can assert that **only the prefix** is ever put in a URL. That is
 * the property the whole scheme rests on, and it is one careless template literal away
 * from being untrue.
 */
export function sha1Parts(plain: string): {
  readonly prefix: string;
  readonly suffix: string;
} {
  const digest = createHash("sha1")
    .update(plain, "utf8")
    .digest("hex")
    .toUpperCase();
  return { prefix: digest.slice(0, 5), suffix: digest.slice(5) };
}

export async function checkBreached(
  plain: string,
  options: BreachCheckOptions = {},
): Promise<BreachResult> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;

  const { prefix, suffix } = sha1Parts(plain);

  // AbortSignal.timeout rather than a manual timer: no handle to leak if the request
  // settles first, which on a registration path happens most of the time.
  let response: Response;
  try {
    response = await doFetch(`${endpoint}/${prefix}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        // Asks HIBP to pad the response with random entries, so the SIZE of the reply
        // does not narrow down which bucket was requested to an observer.
        "Add-Padding": "true",
        Accept: "text/plain",
      },
    });
  } catch (cause) {
    return {
      status: "unavailable",
      reason: cause instanceof Error ? cause.name : "network error",
    };
  }

  if (!response.ok) {
    return { status: "unavailable", reason: `http ${response.status}` };
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    return { status: "unavailable", reason: "unreadable body" };
  }

  // Each line is `SUFFIX:COUNT`. A body that does not look like that at all is treated
  // as unavailable rather than as "no match found" -- parsing hopefully is how a
  // captive portal's login page becomes a clean bill of health.
  if (!/^[0-9A-F]{35}:\d+/m.test(body)) {
    return { status: "unavailable", reason: "unexpected body" };
  }

  for (const line of body.split("\n")) {
    const [candidate, countText] = line.trim().split(":");
    if (candidate !== suffix) continue;

    const count = Number.parseInt(countText ?? "0", 10);
    // A padded entry has a count of 0 and is not a real match.
    if (Number.isFinite(count) && count > 0)
      return { status: "breached", count };
  }

  return { status: "safe" };
}
