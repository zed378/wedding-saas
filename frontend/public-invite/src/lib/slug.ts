/**
 * `P2-08` step 1 — slug resolution, once. `docs/BACKEND/06` § Slug Resolution & Routing.
 *
 * The document is specific about why this is one function rather than one per address
 * format: *"Resolution is implemented **once**, behind a configured strategy, so the
 * MVP's path-based addresses and the eventual per-invitation subdomains are the same code
 * path"*. The alternative is two implementations that agree until the day the subdomain
 * one is written, and then quietly differ about what a valid slug is.
 *
 * Three strategies, in the order the document gives them:
 *
 *   `path`      (MVP)   — the first path segment: `/andi-sarah` -> `andi-sarah`
 *   `subdomain` (later) — the leading `Host` label: `andi-sarah.invitation…` -> `andi-sarah`
 *   custom domain (Phase 7) — a `Host` lookup, checked **before** either of the above
 *
 * ## Everything here is untrusted
 *
 * `docs/BACKEND/06`: *"a path segment is untrusted input, and so is a proxy-supplied
 * header — neither is a fact"*. A `Host` header is set by whatever reached the proxy, and
 * a path segment by whoever typed the URL. Both are validated to the same shape before
 * anything is looked up, and the validation is the same code for both — which is the
 * point of resolving in one place.
 */

/** `docs/PLAN/10`: lowercase letters, digits and hyphens, not at either end. */
const SLUG_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MIN_LENGTH = 3;
const SLUG_MAX_LENGTH = 50;

export type SlugStrategy = "path" | "subdomain";

export interface SlugSource {
  /** The request path, e.g. `/andi-sarah`. */
  readonly pathname?: string | undefined;
  /** The `Host` header, e.g. `andi-sarah.invitation.vizunicum.my.id`. */
  readonly host?: string | undefined;
}

/**
 * The slug this request addresses, or `undefined` if it cannot be one.
 *
 * `undefined` covers every failure together — no segment, a malformed segment, a label
 * that is the bare host — because the caller does the same thing with all of them: the
 * not-found page. Distinguishing them would be a distinction the answer never uses, and
 * `docs/API/08` forbids exposing one anyway.
 */
export function resolveSlug(
  strategy: SlugStrategy,
  source: SlugSource,
  /**
   * Host labels that are the site itself rather than an invitation. Only meaningful for
   * the `subdomain` strategy; `www.invitation…` is the site, not a couple called `www`.
   */
  reservedLabels: readonly string[] = ["www", "invitation", "preview"],
): string | undefined {
  const raw =
    strategy === "path"
      ? firstSegment(source.pathname)
      : leadingLabel(source.host, reservedLabels);

  if (raw === undefined) return undefined;

  // Normalize, then validate. The other order accepts `Andi-Sarah` by lowercasing it
  // away, and the same input typed into the editor would have been refused -- two rules
  // for one address is how a link works in one place and not the other.
  const slug = decode(raw).trim().toLowerCase();

  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) {
    return undefined;
  }
  if (!SLUG_FORMAT.test(slug)) return undefined;

  return slug;
}

/** `/andi-sarah` and `/andi-sarah/` both give `andi-sarah`. A deeper path gives nothing. */
function firstSegment(pathname: string | undefined): string | undefined {
  if (pathname === undefined) return undefined;

  const segments = pathname.split("/").filter((part) => part.length > 0);

  // Exactly one segment. `/andi-sarah/gallery` is not an invitation at a deeper path --
  // it is a path that does not exist, and treating it as `andi-sarah` would serve the
  // invitation at an address that is not its canonical one.
  return segments.length === 1 ? segments[0] : undefined;
}

function leadingLabel(
  host: string | undefined,
  reserved: readonly string[],
): string | undefined {
  if (host === undefined) return undefined;

  // The port is not part of the name, and a proxy may or may not strip it.
  const name = host.split(":")[0] ?? "";
  const labels = name.split(".").filter((part) => part.length > 0);

  // A bare host has no invitation label in front of it. Three labels is the minimum for
  // `slug.invitation.tld`; fewer means the request is for the site itself.
  if (labels.length < 3) return undefined;

  const label = labels[0]!;
  return reserved.includes(label) ? undefined : label;
}

/**
 * A path segment arrives percent-encoded.
 *
 * `decodeURIComponent` throws on a malformed sequence — `%zz` — which is a thing an
 * attacker will send, so the throw is caught and turned into "not a slug" rather than a
 * 500 on the public page.
 */
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
