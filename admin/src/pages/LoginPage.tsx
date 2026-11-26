import { useState, type FormEvent } from "react";
import { Button, Card, CardHeader, Input } from "@wi/ui";
import { useAdminAuth } from "../auth/admin-auth.js";
import { useRouter } from "../router.js";

export function LoginPage() {
  const { login } = useAdminAuth();
  const { navigate } = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (!email.trim() || !password.trim()) {
        setError("Email dan kata sandi wajib diisi.");
        setIsLoading(false);
        return;
      }

      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
        credentials: "include",
      });

      if (!res.ok) {
        const failure = await res.json().catch(() => null);
        throw new Error(
          failure?.error?.message ??
            "Autentikasi gagal. Periksa kembali kredensial Anda.",
        );
      }

      if (res.ok) {
        const body = await res.json();
        if (body?.data?.requires_mfa_setup) {
          if (
            typeof body.data.setup_ticket !== "string" ||
            !body.data.setup_ticket
          )
            throw new Error("Tiket pendaftaran tidak tersedia.");
          navigate(
            `/mfa/enroll?ticket=${encodeURIComponent(body.data.setup_ticket)}`,
          );
          return;
        }
        if (body?.data?.requires_mfa) {
          if (typeof body.data.mfa_ticket !== "string" || !body.data.mfa_ticket)
            throw new Error("Tiket verifikasi tidak tersedia.");
          navigate(
            `/mfa/verify?ticket=${encodeURIComponent(body.data.mfa_ticket)}`,
          );
          return;
        }
        if (
          body?.data?.user?.role !== "admin" &&
          body?.data?.user?.role !== "super_admin"
        ) {
          navigate("/unauthorized");
          return;
        }
        login(body.data.access_token, body.data.user);
        navigate("/");
        return;
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Autentikasi gagal. Periksa kembali kredensial Anda.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-page flex-col items-center justify-center p-6 text-text"
    >
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-display font-bold">Vizunicum Admin</h1>
          <p className="mt-1 text-body text-text-muted">
            Portal manajemen internal & administrasi sistem
          </p>
        </div>

        <Card>
          <CardHeader
            title="Masuk Administrator"
            description="Akses dibatasi hanya untuk staf dan administrator."
          />
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div
                role="alert"
                className="rounded-md bg-danger-50 p-3 text-body-sm text-danger-700"
              >
                {error}
              </div>
            )}

            <Input
              id="admin-email"
              label="Email Administrator"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@vizunicum.my.id"
              required
              autoComplete="username"
            />

            <Input
              id="admin-password"
              label="Kata Sandi"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              autoComplete="current-password"
            />

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                loading={isLoading}
              >
                Masuk ke Panel Admin
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </main>
  );
}
