import { readConfig } from "../../../../../lib/config";
import { forwardedForHeaders } from "../../../../../lib/forwarded-for";

/**
 * `P4-11` — `POST /public/i/:slug/rsvp` proxy on the invitation host.
 *
 * Forwards guest attendance confirmation to the backend API while preserving client IP.
 */

const MAX_BODY_BYTES = 8192;

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ readonly slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  if (!slug) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "INVALID_SLUG", message: "Slug tidak valid" },
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "PAYLOAD_TOO_LARGE", message: "Ukuran data melebihi batas" },
      }),
      { status: 413, headers: { "content-type": "application/json" } },
    );
  }

  try {
    const upstream = await fetch(
      `${readConfig().apiBaseUrl}/public/i/${encodeURIComponent(slug)}/rsvp`,
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

    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "Layanan konfirmasi kehadiran sedang tidak tersedia.",
        },
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }
}
