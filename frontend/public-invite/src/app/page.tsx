/**
 * The host root.
 *
 * `invitation.zedth.my.id` serves invitations at `/{slug}` and nothing else
 * (`docs/PLAN/10`, ADR-024, and `P0-23`'s DoD: "nothing else on that host reaches any
 * other app"). The bare host is not a landing page -- it points at the application host
 * and stops.
 */
export default function RootPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Undangan Digital</h1>
      <p className="text-neutral-600">
        Alamat ini menampilkan undangan. Buka tautan undangan yang Anda terima.
      </p>
    </main>
  );
}
