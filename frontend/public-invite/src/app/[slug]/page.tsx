import { notFound } from "next/navigation";

/**
 * P0-22 — the invitation route, as a shell.
 *
 * `P0-23`'s DoD requires that `invitation.zedth.my.id/{slug}` "reaches the public-invite
 * app over HTTPS with the slug available to the handler". This is the handler, and it is
 * the thing that proves the routing end to end before publishing exists to depend on it.
 *
 * `P2-02` puts the real renderer here and `P3` connects the public API. Until then it
 * renders the slug and nothing else -- which is enough to answer "did the request reach
 * the right app with the right parameter", and is honest about being nothing more.
 */
export default async function InvitationPage({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>;
}) {
  const { slug } = await params;

  // The shape docs/PLAN/10 allows: lowercase letters, digits and hyphens. Anything else
  // cannot be a real slug, so it is a 404 rather than a lookup -- a rejected request is
  // one that never reaches the database.
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) notFound();

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm tracking-wide text-neutral-500 uppercase">
        Undangan
      </p>
      <h1 className="text-2xl font-semibold" data-slug={slug}>
        {slug}
      </h1>
      <p className="text-neutral-600">Perender template dibangun pada P2-02.</p>
    </main>
  );
}
