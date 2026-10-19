import { Button, Card, CardHeader, Badge } from "@wi/ui";
import { useAdminAuth } from "../auth/admin-auth.js";
import { useRouter } from "../router.js";

export function UnauthorizedPage() {
  const { user, logout } = useAdminAuth();
  const { navigate } = useRouter();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  // App origin for standard user redirect
  const appOrigin =
    typeof window !== "undefined" && window.location.hostname === "localhost"
      ? "http://localhost:3100"
      : "https://app.vizunicum.my.id";

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-page flex-col items-center justify-center p-6 text-text"
    >
      <div className="w-full max-w-lg">
        <Card>
          <CardHeader
            title="Akses Ditolak (403)"
            description="Izin administratif diperlukan untuk mengakses halaman ini."
            actions={<Badge tone="danger">Unauthorized</Badge>}
          />
          <div className="flex flex-col gap-4">
            <p className="text-body text-text-muted">
              Akun Anda{" "}
              {user?.email ? (
                <strong className="text-text font-semibold">{user.email}</strong>
              ) : (
                "saat ini"
              )}{" "}
              terautentikasi sebagai pengguna biasa, namun tidak memiliki peran{" "}
              <code className="text-primary-600 font-mono text-body-sm">admin</code> atau{" "}
              <code className="text-primary-600 font-mono text-body-sm">super_admin</code>.
            </p>
            <p className="text-body text-text-muted">
              Panel administrasi Vizunicum berada di batas keamanan tersendiri (Trust Boundary
              3→4) dan hanya dapat diakses oleh personel staf terotorisasi.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <a
                href={appOrigin}
                className="inline-flex items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-button font-medium text-text-inverse transition-colors hover:bg-primary-700 focus-ring"
              >
                Kembali ke Aplikasi Utama
              </a>
              <Button variant="secondary" onClick={handleLogout}>
                Keluar (Logout)
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
