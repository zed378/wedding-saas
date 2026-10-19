"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { SectionProps } from "@wi/template-renderer";
import { readGuestName } from "../lib/guest-name";

const PENDING_NOTICE = "Buku tamu dinonaktifkan dalam mode pratinjau.";

function resolveSlug(): string {
  if (typeof window === "undefined") return "";
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length > 0 && parts[0] !== "public" && parts[0] !== "preview") {
    return parts[0]!;
  }
  return "";
}

interface GuestbookEntry {
  readonly id?: string;
  readonly guest_name: string;
  readonly message: string;
  readonly created_at?: string;
}

export function PublicGuestbookWall({ mode, data }: SectionProps) {
  const [entries, setEntries] = useState<readonly GuestbookEntry[]>([]);
  const [guestName, setGuestName] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const name = readGuestName(window.location.search);
      if (name) setGuestName(name);

      const slug = resolveSlug();
      if (slug && mode === "public") {
        void fetchEntries(slug, 1);
      }
    }
  }, [mode]);

  const fetchEntries = async (slug: string, pageNum: number) => {
    setIsLoadingList(true);
    try {
      const res = await fetch(
        `/public/i/${encodeURIComponent(slug)}/guestbook?page=${pageNum}&limit=20`,
      );
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        if (pageNum === 1) {
          setEntries(json.data);
        } else {
          setEntries((prev) => [...prev, ...json.data]);
        }
        if (json.meta) {
          setHasMore(pageNum < json.meta.total_pages);
        }
      }
    } catch {
      // Best-effort fetching for guestbook entries
    } finally {
      setIsLoadingList(false);
    }
  };

  if (mode !== "public") {
    return (
      <section className="wi-section" aria-label="Buku Tamu">
        <h2 className="wi-center">Buku Tamu & Ucapan</h2>
        <form className="wi-stack" onSubmit={(e) => e.preventDefault()}>
          <div className="wi-field">
            <label htmlFor="preview-guestbook-name">Nama</label>
            <input
              id="preview-guestbook-name"
              className="wi-input"
              type="text"
              disabled
              value=""
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
    setFeedbackNotice(null);

    const slug = resolveSlug();
    if (!slug) {
      setErrorMessage("Alamat undangan tidak valid.");
      return;
    }

    if (!guestName.trim()) {
      setErrorMessage("Silakan isi nama Anda.");
      return;
    }

    if (!message.trim()) {
      setErrorMessage("Silakan tulis ucapan atau doa Anda.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/public/i/${encodeURIComponent(slug)}/guestbook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          guest_name: guestName.trim(),
          message: message.trim(),
        }),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const errorMsg =
          body?.error?.message ??
          "Terjadi kesalahan saat mengirim ucapan. Silakan coba lagi.";
        setErrorMessage(errorMsg);
        return;
      }

      // Check if entry was approved or routed to pending
      const createdStatus = body?.data?.status;
      if (createdStatus === "approved") {
        setFeedbackNotice("Ucapan Anda berhasil dikirim!");
        setEntries((prev) => [
          {
            id: body?.data?.id ?? String(Date.now()),
            guest_name: guestName.trim(),
            message: message.trim(),
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
      } else {
        setFeedbackNotice(
          "Ucapan Anda telah terkirim dan sedang menunggu persetujuan mempelai sebelum ditampilkan.",
        );
      }

      setMessage("");
    } catch {
      setErrorMessage("Koneksi gagal. Silakan periksa jaringan internet Anda dan coba lagi.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLoadMore = () => {
    const slug = resolveSlug();
    if (!slug || isLoadingList) return;
    const nextPage = page + 1;
    setPage(nextPage);
    void fetchEntries(slug, nextPage);
  };

  return (
    <section className="wi-section" aria-label="Buku Tamu">
      <h2 className="wi-center">Buku Tamu & Ucapan</h2>

      {/* Guestbook Submission Form */}
      <form className="wi-stack max-w-md mx-auto text-base mb-8" onSubmit={handleSubmit}>
        {feedbackNotice && (
          <div
            role="status"
            aria-live="polite"
            className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            {feedbackNotice}
          </div>
        )}

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
          <label htmlFor="public-gb-name" className="text-base font-medium">
            Nama Anda <span className="text-red-500">*</span>
          </label>
          <input
            id="public-gb-name"
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

        <div className="wi-field">
          <label htmlFor="public-gb-message" className="text-base font-medium">
            Ucapan & Doa <span className="text-red-500">*</span>
          </label>
          <textarea
            id="public-gb-message"
            name="message"
            className="wi-input text-base"
            rows={3}
            required
            maxLength={1000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tulis ucapan dan doa terbaik Anda untuk kedua mempelai..."
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="wi-button text-base font-medium py-3"
        >
          {isSubmitting ? "Mengirim Ucapan..." : "Kirim Ucapan"}
        </button>
      </form>

      {/* Guestbook Messages Wall */}
      {entries.length > 0 && (
        <div className="max-w-md mx-auto space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
            Doa & Ucapan ({entries.length})
          </h3>
          <ul className="wi-stack" aria-label="Daftar ucapan tamu">
            {entries.map((item, idx) => (
              <li key={item.id ?? idx} className="wi-card">
                <p className="text-base whitespace-pre-wrap">&ldquo;{item.message}&rdquo;</p>
                <p className="wi-muted mt-2 text-sm font-medium">— {item.guest_name}</p>
              </li>
            ))}
          </ul>

          {hasMore && (
            <div className="wi-center pt-2">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={isLoadingList}
                className="wi-button wi-button-quiet text-sm font-medium"
              >
                {isLoadingList ? "Memuat..." : "Tampilkan Lebih Banyak"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
