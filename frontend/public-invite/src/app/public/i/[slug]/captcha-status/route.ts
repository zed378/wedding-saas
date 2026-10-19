import { readConfig } from "../../../../../lib/config";
import { forwardedForHeaders } from "../../../../../lib/forwarded-for";

/**
 * `P4-11` — `GET /public/i/:slug/captcha-status` proxy on the invitation host.
 *
 * Checks whether an adaptive Turnstile CAPTCHA challenge is currently active.
 */

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  if (!slug) return new Response(null, { status: 400 });

  try {
    const upstream = await fetch(
      `${readConfig().apiBaseUrl}/public/i/${encodeURIComponent(slug)}/captcha-status`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          ...forwardedForHeaders(request.headers.get("x-forwarded-for")),
        },
        cache: "no-store",
      },
    );

    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return new Response(JSON.stringify({ challenge_required: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
}
