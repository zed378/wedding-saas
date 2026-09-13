import type { Metadata } from "next";

/**
 * `P2-08` step 4 — the not-found page. `docs/UI-UX/14` § Special States.
 *
 * *"`expired`/not-found invitation: a simple fallback page, not a technical error — a
 * friendly tone."*
 *
 * ## One page for every reason
 *
 * A guest arriving here may be holding a link to an invitation that was never published,
 * one that was taken down, one that has expired, or a mistyped address. `docs/API/08`
 * requires the API not to distinguish those, and this page must not either — not as a
 * formality, but because the alternative is telling a stranger that a particular couple's
 * unpublished invitation exists.
 *
 * So the wording says what is true for all of them and nothing more: the invitation is
 * not available at this address. It does not say "expired", which would be wrong three
 * times out of four, and it does not say "deleted", which would be a guess about somebody
 * else's decision.
 *
 * ## No link back
 *
 * There is nowhere to send them. This host serves invitations and nothing else
 * (`docs/BACKEND/06`), and a guest who followed a wedding link is not a prospective
 * customer — putting a "create your own invitation" call to action on the page a bereaved
 * or confused guest lands on is the kind of thing that reads as tasteless later.
 */
export const metadata: Metadata = {
  title: "Undangan tidak ditemukan",
  // A missing page must never be indexed, whatever a particular invitation's
  // `seo_indexable` says — the setting is about an invitation, and there is none here.
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 px-6">
      <div className="w-full max-w-sm rounded-xl bg-white px-6 py-10 text-center shadow-sm">
        <p aria-hidden="true" className="text-4xl">
          ✉️
        </p>
        <h1 className="mt-4 text-lg font-semibold text-neutral-900">
          Undangan tidak tersedia
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          Undangan yang Anda cari tidak tersedia di alamat ini. Mungkin
          tautannya kurang lengkap, atau undangan ini sudah tidak ditayangkan.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-neutral-600">
          Coba periksa kembali tautan yang Anda terima, atau hubungi pengirim
          undangan.
        </p>
      </div>
    </main>
  );
}
