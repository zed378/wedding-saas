import { readConfig } from "../../../../../lib/config";
import { forwardedForHeaders } from "../../../../../lib/forwarded-for";

/**
 * `P4-11` — `POST/GET /public/i/:slug/guestbook` proxy on the invitation host.
 *
 * Forwards guestbook submission and approved listing to the backend API.
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
      `${readConfig().apiBaseUrl}/public/i/${encodeURIComponent(slug)}/guestbook`,
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
          message: "Layanan buku tamu sedang tidak tersedia.",
        },
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }
}

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  if (!slug) return new Response(null, { status: 400 });

  const url = new URL(request.url);
  const search = url.search;

  try {
    const upstream = await fetch(
      `${readConfig().apiBaseUrl}/public/i/${encodeURIComponent(slug)}/guestbook${search}`,
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
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "Layanan buku tamu sedang tidak tersedia.",
        },
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }
}
