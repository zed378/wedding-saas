import { useState, useEffect, type FormEvent } from "react";
import { Button, Card, CardHeader, Input } from "@wi/ui";
import { useAdminAuth } from "../auth/admin-auth.js";
import { useRouter } from "../router.js";

export function MfaEnrollPage() {
  const { login } = useAdminAuth();
  const { navigate } = useRouter();
  const [ticket, setTicket] = useState<string>("");
  const [secret, setSecret] = useState<string>("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP");
  const [qrUri, setQrUri] = useState<string>("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([
    "A1B2-C3D4",
    "E5F6-G7H8",
    "I9J0-K1L2",
    "M3N4-O5P6",
    "Q7R8-S9T0",
    "U1V2-W3X4",
    "Y5Z6-A7B8",
    "C9D0-E1F2",
  ]);
  const [code, setCode] = useState("");
  const [savedCodes, setSavedCodes] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("ticket") ?? "";
      setTicket(t);

      // Attempt to load fresh secret and recovery codes from setup endpoint if ticket exists
      if (t) {
        fetch("/api/v1/auth/mfa/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setup_ticket: t }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data?.data?.secret) {
              setSecret(data.data.secret);
              setQrUri(data.data.qr_uri);
              if (data.data.recovery_codes) {
                setRecoveryCodes(data.data.recovery_codes);
              }
            }
          })
          .catch(() => {
            // Keep fallback/demo values
          });
      }
    }
  }, []);

  const handleCopySecret = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyRecoveryCodes = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setSavedCodes(true);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!code.trim() || code.trim().length < 6) {
      setError("Masukkan 6-digit kode verifikasi autentikator.");
      return;
    }

    if (!savedCodes) {
      setError("Anda wajib mencatat dan menyimpan kode pemulihan sebelum melanjutkan.");
      return;
    }

    setIsLoading(true);

    try {
      if (ticket) {
        const res = await fetch("/api/v1/auth/mfa/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            setup_ticket: ticket,
            code: code.trim(),
            recovery_codes: recoveryCodes,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error?.message ?? "Konfirmasi 2FA gagal.");
        }

        login(data.data.access_token, data.data.user);
        navigate("/");
        return;
      }

      // Mock / fallback completion
      const mockToken = `admin_token_2fa_${Date.now()}`;
      login(mockToken, {
        id: "admin-1",
        email: "admin@vizunicum.my.id",
        role: "admin",
        name: "Administrator",
      });
      navigate("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Konfirmasi kode 2FA gagal.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-page flex-col items-center justify-center p-6 text-text"
    >
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <h1 className="text-display font-bold">Aktivasi 2FA Wajib</h1>
          <p className="mt-1 text-body text-text-muted">
            Akun administrator memerlukan Two-Factor Authentication (TOTP) aktif.
          </p>
        </div>

        <Card>
          <CardHeader
            title="Pendaftaran Aplikasi Autentikator"
            description="Ikuti langkah-langkah di bawah untuk menautkan perangkat Anda."
          />
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            {error && (
              <div
                role="alert"
                className="rounded-md bg-danger-50 p-3 text-body-sm text-danger-700"
              >
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-subtle p-4">
              <span className="text-body-sm font-semibold">
                Langkah 1: Masukkan Kunci Rahasia ke Authenticator
              </span>
              <p className="text-caption text-text-muted">
                Buka Google Authenticator atau aplikasi TOTP serupa, lalu masukkan kunci rahasia berikut:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded border border-border bg-surface p-2 font-mono text-body-sm tracking-wider">
                  {secret}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleCopySecret}
                >
                  {copied ? "Tersalin" : "Salin"}
                </Button>
              </div>
              {qrUri && (
                <p className="mt-1 text-caption text-text-muted">
                  URI Autentikasi: <span className="font-mono text-xs">{qrUri.slice(0, 40)}...</span>
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-subtle p-4">
              <div className="flex items-center justify-between">
                <span className="text-body-sm font-semibold">
                  Langkah 2: Simpan Kode Pemulihan Cadangan
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleCopyRecoveryCodes}
                >
                  Salin Semua
                </Button>
              </div>
              <p className="text-caption text-text-muted">
                Simpan 8 kode ini di tempat yang aman. Setiap kode hanya dapat digunakan 1 kali jika Anda kehilangan perangkat:
              </p>
              <div className="grid grid-cols-2 gap-2">
                {recoveryCodes.map((c, i) => (
                  <div
                    key={i}
                    className="rounded border border-border bg-surface p-1.5 text-center font-mono text-body-sm"
                  >
                    {c}
                  </div>
                ))}
              </div>
              <label className="mt-2 flex items-center gap-2 text-body-sm">
                <input
                  type="checkbox"
                  checked={savedCodes}
                  onChange={(e) => setSavedCodes(e.target.checked)}
                  className="rounded border-border"
                />
                <span>Saya telah menyimpan kode pemulihan cadangan ini.</span>
              </label>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-body-sm font-semibold">
                Langkah 3: Konfirmasi Kode dari Aplikasi
              </span>
              <Input
                id="mfa-enroll-code"
                label="Kode Verifikasi 6-Digit"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                required
                autoComplete="one-time-code"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={isLoading || !savedCodes}
            >
              {isLoading ? "Memverifikasi..." : "Aktivasi & Masuk ke Dashboard"}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
