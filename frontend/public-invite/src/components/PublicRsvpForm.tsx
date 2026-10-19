"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { SectionProps } from "@wi/template-renderer";
import { readGuestName } from "../lib/guest-name";

const PENDING_NOTICE = "Formulir ini dinonaktifkan dalam mode pratinjau.";

function resolveSlug(): string {
  if (typeof window === "undefined") return "";
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length > 0 && parts[0] !== "public" && parts[0] !== "preview") {
    return parts[0]!;
  }
  return "";
}

export function PublicRsvpForm({ mode, data }: SectionProps) {
  const [guestName, setGuestName] = useState("");
  const [attendance, setAttendance] = useState<"attending" | "not_attending" | "maybe">("attending");
  const [guestCount, setGuestCount] = useState(1);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const name = readGuestName(window.location.search);
      if (name) setGuestName(name);
    }
  }, []);

  if (mode !== "public") {
    return (
      <section className="wi-section" aria-label="Konfirmasi Kehadiran">
        <h2 className="wi-center">Konfirmasi Kehadiran</h2>
        <form className="wi-stack" onSubmit={(e) => e.preventDefault()}>
          <div className="wi-field">
            <label htmlFor="preview-rsvp-name">Nama</label>
            <input
              id="preview-rsvp-name"
              className="wi-input"
              type="text"
              disabled
              value=""
              placeholder="Nama lengkap"
            />
          </div>
          <p className="wi-muted wi-center">{PENDING_NOTICE}</p>
        </form>
      </section>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const slug = resolveSlug();
    if (!slug) {
      setErrorMessage("Alamat undangan tidak valid.");
      return;
    }

    if (!guestName.trim()) {
      setErrorMessage("Silakan isi nama Anda.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/public/i/${encodeURIComponent(slug)}/rsvp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          guest_name: guestName.trim(),
          attendance_status: attendance,
          guest_count: attendance === "attending" ? guestCount : 1,
          message: message.trim() || undefined,
        }),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const errorMsg =
          body?.error?.message ??
          "Terjadi kesalahan saat mengirim konfirmasi. Silakan coba lagi.";
        setErrorMessage(errorMsg);
        return;
      }

      setIsSubmitted(true);
    } catch {
      setErrorMessage("Koneksi gagal. Silakan periksa jaringan internet Anda dan coba lagi.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="wi-section" aria-label="Konfirmasi Kehadiran">
      <h2 className="wi-center">Konfirmasi Kehadiran</h2>

      {isSubmitted ? (
        <div
          role="status"
          aria-live="polite"
          className="wi-card wi-center py-8"
        >
          <h3 className="text-xl font-bold">Terima Kasih!</h3>
          <p className="mt-2 text-base">
            Konfirmasi kehadiran atas nama <strong>{guestName}</strong> telah berhasil dicatat.
          </p>
        </div>
      ) : (
        <form className="wi-stack max-w-md mx-auto text-base" onSubmit={handleSubmit}>
          {errorMessage && (
            <div
              role="alert"
              aria-live="assertive"
              className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
            >
              {errorMessage}
            </div>
          )}

          <div className="wi-field">
            <label htmlFor="public-rsvp-name" className="text-base font-medium">
              Nama Lengkap <span className="text-red-500">*</span>
            </label>
            <input
              id="public-rsvp-name"
              name="guest_name"
              className="wi-input text-base"
              type="text"
              autoComplete="name"
              required
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Masukkan nama Anda"
            />
          </div>

          <fieldset className="wi-field">
            <legend className="text-base font-medium">Konfirmasi Kehadiran</legend>
            <div className="mt-1 flex flex-wrap gap-4">
              {[
                ["attending", "Hadir"],
                ["not_attending", "Tidak Hadir"],
                ["maybe", "Ragu-ragu"],
              ].map(([value, label]) => (
                <label
                  key={value}
                  htmlFor={`public-rsvp-${value}`}
                  className="flex items-center gap-2 text-base cursor-pointer"
                >
                  <input
                    id={`public-rsvp-${value}`}
                    type="radio"
                    name="attendance_status"
                    value={value}
                    checked={attendance === value}
                    onChange={() =>
                      setAttendance(value as "attending" | "not_attending" | "maybe")
                    }
                    className="h-5 w-5"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {attendance === "attending" && (
            <div className="wi-field">
              <label htmlFor="public-rsvp-count" className="text-base font-medium">
                Jumlah Tamu Hadir
              </label>
              <select
                id="public-rsvp-count"
                name="guest_count"
                className="wi-input text-base"
                value={guestCount}
                onChange={(e) => setGuestCount(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                  <option key={num} value={num}>
                    {num} orang
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="wi-field">
            <label htmlFor="public-rsvp-message" className="text-base font-medium">
              Ucapan / Doa (Opsional)
            </label>
            <textarea
              id="public-rsvp-message"
              name="message"
              className="wi-input text-base"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tulis ucapan dan doa untuk kedua mempelai..."
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="wi-button text-base font-medium py-3"
          >
            {isSubmitting ? "Mengirim..." : "Kirim Konfirmasi"}
          </button>
        </form>
      )}
    </section>
  );
}
