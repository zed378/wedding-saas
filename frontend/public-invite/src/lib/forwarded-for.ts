/**
 * `P2-13` — carrying a guest's address across this server's hop to the API.
 *
 * Everything this host asks the API for — the invitation during server rendering, a
 * preview, a web-vitals report — leaves from this server's address. The API rate-limits
 * `/public/*` per client address (`general-public`, 100 a minute), so without the guest's
 * `X-Forwarded-For` every guest of every wedding shares one bucket: an invitation sent to
 * a few hundred people on WhatsApp starts answering 429 at the hundred-and-first page view,
 * and the page renders its outage state for a wedding that is perfectly fine.
 *
 * ## Forwarded as received, never appended to
 *
 * The API picks the client out of the header with Express's `trust proxy` hop count
 * (`TRUSTED_PROXY_HOPS`), counting from the right. Passing the header on unchanged makes
 * this server stand exactly where the origin proxy stands for a direct API request, so one
 * hop count is right for both paths. Appending the proxy's address would shift every entry
 * by one and hand the API the address of Cloudflare's edge instead of the guest.
 *
 * A client can write anything on the LEFT of the header; only the entries on the right
 * were written by a proxy, and those are what the API reads. So nothing here needs to
 * trust the value — it only needs not to lose the right-hand end of it.
 */

/** Longer than any honest chain of proxies; short enough not to forward a padded header. */
const MAX_LENGTH = 512;

export function forwardedForHeaders(
  value: string | null | undefined,
): Record<string, string> {
  if (value === null || value === undefined) return {};
  const trimmed = value.trim();
  if (trimmed === "") return {};
  if (trimmed.length <= MAX_LENGTH) return { "x-forwarded-for": trimmed };

  // Keep the right-hand end — the part a proxy wrote — and drop the partial entry the cut
  // leaves at the front.
  const tail = trimmed.slice(-MAX_LENGTH);
  const comma = tail.indexOf(",");
  const whole = comma === -1 ? tail : tail.slice(comma + 1).trim();
  return whole === "" ? {} : { "x-forwarded-for": whole };
}
