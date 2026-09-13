import { readConfig } from "../../../lib/config";
import { forwardedForHeaders } from "../../../lib/forwarded-for";

/**
 * `P2-13` — `POST /public/rum` on the invitation host, forwarded to the API.
 *
 * `docs/API/08`: the `/public/*` routes are *"reachable at `/public/*` on the public invitation
 * host, proxied to the API, so a guest's … submission is a same-origin request from the page
 * they are reading"*. This is the first `/public/*` route the page itself calls, and a route
 * handler is the proxy for it: a runtime forward reads `API_INTERNAL_BASE_URL` per request,
 * where a `next.config` rewrite would have fixed the address at build time.
 *
 * ## Why this does not shadow an invitation
 *
 * `public` is on the slug blocklist (`slug-blocklist.json`), so no invitation can live at
 * `/public`. The route allowlist test (`lazy-registry.spec.ts`, R15) names this directory with
 * that reason.
 *
 * ## Forwarded as-is, bounded
 *
 * The body is passed through unparsed; the API validates it strictly. It is capped at 1KB here
 * so this handler cannot be used to push large bodies at the API, and the API's rate limiter
 * applies to the forwarded request.
 *
 * `X-Forwarded-For` is passed on as received (`lib/forwarded-for.ts`, which explains why
 * as received and not appended to). Without it every guest's report would arrive from this
 * server's address and share one rate-limit bucket with every other guest.
 * `P4-01`/`P4-03` proxy guest submissions the same way.
 */

const MAX_BODY_BYTES = 1024;

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  try {
    const upstream = await fetch(`${readConfig().apiBaseUrl}/public/rum`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...forwardedForHeaders(request.headers.get("x-forwarded-for")),
      },
      body,
      cache: "no-store",
    });
    return new Response(null, { status: upstream.status });
  } catch {
    // The API being down is not the guest's problem and must not be retried by them.
    return new Response(null, { status: 204 });
  }
}
