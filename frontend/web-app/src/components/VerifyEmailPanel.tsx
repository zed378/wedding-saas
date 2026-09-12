"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@wi/ui";

import { useAuth } from "../lib/auth";
import { toFriendlyError, type FriendlyError } from "../lib/error-messages";
import { AuthShell, FormError, FormStatus } from "./AuthShell";

/**
 * P1-20 — the landing page for the link in a verification email. `docs/API/01` step 3.
 *
 * ## It redeems on arrival, and it redeems once
 *
 * The user clicked a link; asking them to click a second button to complete an action they
 * have already committed to is a step that exists only because it was easier to build. So
 * the token is submitted on mount.
 *
 * `redeemed` guards against React's development double-invoke of effects, which would
 * otherwise present the token twice — and a one-time token presented twice is, correctly,
 * rejected the second time. The user would see "this link has expired" having clicked a
 * perfectly good link, which is the kind of bug that only appears in one environment.
 *
 * ## An expired link offers a new one
 *
 * Card step 5. `resend-verification` needs a session, so the button is only useful to
 * somebody who is signed in — which is stated rather than left to be discovered by a 401.
 */

export type VerifyState = "verifying" | "verified" | "failed";

export interface VerifyEmailPanelProps {
  readonly token: string | undefined;
  readonly loginHref: string;
  readonly dashboardHref: string;
}

export function VerifyEmailPanel({
  token,
  loginHref,
  dashboardHref,
}: VerifyEmailPanelProps) {
  const { api, status } = useAuth();
  const [state, setState] = useState<VerifyState>(
    token === undefined || token.length === 0 ? "failed" : "verifying",
  );
  const [problem, setProblem] = useState<FriendlyError | undefined>(
    token === undefined || token.length === 0
      ? { message: "Tautan verifikasi tidak lengkap." }
      : undefined,
  );
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const redeemed = useRef(false);

  useEffect(() => {
    if (token === undefined || token.length === 0) return;
    // React invokes effects twice in development. A one-time token presented twice is
    // rejected the second time, and the user would be told a good link had expired.
    if (redeemed.current) return;
    redeemed.current = true;

    void (async () => {
      try {
        await api.request("/auth/verify-email", {
          method: "POST",
          body: { token },
          anonymous: true,
        });
        setState("verified");
      } catch (error) {
        setProblem(toFriendlyError(error));
        setState("failed");
      }
    })();
  }, [api, token]);

  const resend = async () => {
    if (resending) return;
    setResending(true);
    try {
      await api.request("/auth/resend-verification", { method: "POST" });
      setResent(true);
    } catch (error) {
      setProblem(toFriendlyError(error));
    } finally {
      setResending(false);
    }
  };

  if (state === "verifying") {
    return (
      <AuthShell title="Memverifikasi email">
        {/*
         * A live region rather than a spinner alone: a spinner is invisible to a screen
         * reader, and this page does its work before the user does anything at all.
         */}
        <FormStatus message="Sedang memverifikasi alamat email Anda…" />
      </AuthShell>
    );
  }

  if (state === "verified") {
    return (
      <AuthShell
        title="Email terverifikasi"
        description="Terima kasih. Akun Anda kini dapat menerbitkan undangan dan melakukan pembayaran."
      >
        <FormStatus message="Alamat email Anda telah terverifikasi." />
        <a
          className="focus-ring mt-6 inline-flex w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-text-inverse hover:bg-primary-700"
          href={status === "authenticated" ? dashboardHref : loginHref}
        >
          {status === "authenticated" ? "Ke dasbor" : "Masuk"}
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Tautan tidak berlaku"
      description="Tautan verifikasi ini sudah digunakan atau kedaluwarsa."
      footer={
        <a className="focus-ring text-primary-700 underline" href={loginHref}>
          Kembali ke halaman masuk
        </a>
      }
    >
      <FormError message={problem?.message} />
      <FormStatus
        message={resent ? "Tautan verifikasi baru telah dikirim." : undefined}
      />

      {status === "authenticated" ? (
        <Button
          type="button"
          className="w-full"
          loading={resending}
          onClick={() => void resend()}
        >
          Kirim ulang tautan verifikasi
        </Button>
      ) : (
        // Stated rather than left to a 401. `resend-verification` needs a session, so
        // somebody who arrived from an email in a different browser has to sign in first.
        <p className="text-sm text-text-muted">
          Masuk terlebih dahulu untuk meminta tautan verifikasi baru.
        </p>
      )}
    </AuthShell>
  );
}
