import { readConfig } from "../../../../../lib/config";
import { forwardedForHeaders } from "../../../../../lib/forwarded-for";

/**
 * `P4-09` — `POST /public/i/:slug/view` on the invitation host, forwarded to the API.
 *
 * `docs/API/08`: `/public/*` routes are reachable at `/public/*` on the public invitation host,
 * proxied to the API so guest actions are same-origin.
 */

const MAX_BODY_BYTES = 1024;

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ readonly slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  if (!slug) return new Response(null, { status: 400 });

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  try {
    const upstream = await fetch(
      `${readConfig().apiBaseUrl}/public/i/${encodeURIComponent(slug)}/view`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...forwardedForHeaders(request.headers.get("x-forwarded-for")),
        },
        body: body.length > 0 ? body : "{}",
        cache: "no-store",
      },
    );
    return new Response(null, { status: upstream.status });
  } catch {
    // Analytics upstream errors fail silently without impacting the visitor.
    return new Response(null, { status: 204 });
  }
}
