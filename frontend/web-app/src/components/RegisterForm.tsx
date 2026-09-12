"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { Button, Input } from "@wi/ui";

import { useAuth } from "../lib/auth";
import {
  formatWait,
  toFriendlyError,
  type FriendlyError,
} from "../lib/error-messages";
import { AuthShell, FormError, FormStatus } from "./AuthShell";

/**
 * P1-20 — create an account. `docs/API/01` § Registration Flow.
 *
 * ## The success message is the same whether or not the address was already taken
 *
 * `P1-02` made the endpoint answer identically for a new address and an existing one — a
 * registration form is otherwise the easiest user-enumeration oracle in any product. This
 * screen must not undo that by rendering a different outcome, which is why there is exactly
 * one success state and it says "check your email" rather than "account created".
 *
 * ## Verification does not block the product
 *
 * `docs/API/01` step 2: a user may sign in and build a draft without verifying. Publishing
 * and checkout are where it is required (`P3-01`, `P3-06`). So this screen does not park the
 * user on a "please verify" wall — it says what happened and offers the way forward.
 */

export interface RegisterFormProps {
  readonly loginHref: string;
  /** Preserved through the flow so a template chosen before signing up survives. */
  readonly next?: string;
  readonly alternatives?: ReactNode;
}

export function RegisterForm({
  loginHref,
  next,
  alternatives,
}: RegisterFormProps) {
  const { register } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<FriendlyError | undefined>(undefined);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setProblem(undefined);
    setSubmitting(true);

    try {
      await register({ email, password, fullName });
      setSent(true);
    } catch (error) {
      setProblem(toFriendlyError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const message =
    problem === undefined
      ? undefined
      : problem.retryAfterSeconds === undefined
        ? problem.message
        : `${problem.message} Coba lagi dalam ${formatWait(problem.retryAfterSeconds)}.`;

  if (sent) {
    const continueHref =
      next === undefined
        ? loginHref
        : `${loginHref}${loginHref.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;

    return (
      <AuthShell
        title="Cek email Anda"
        description="Kami telah mengirim tautan verifikasi jika alamat tersebut dapat digunakan."
      >
        <FormStatus message="Tautan verifikasi telah dikirim. Buka email Anda untuk melanjutkan." />
        <p className="text-sm text-text-muted">
          Anda tetap dapat masuk dan mulai menyusun undangan sekarang;
          verifikasi baru diperlukan saat menerbitkan atau membayar.
        </p>
        {/*
         * A link, styled like a button, rather than a Button wrapping a link. It navigates,
         * so it must be an anchor: a <button> that navigates cannot be opened in a new tab,
         * has no href for the status bar, and is announced as a button to somebody who is
         * about to leave the page.
         */}
        <a
          className="focus-ring mt-6 inline-flex w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-text-inverse hover:bg-primary-700"
          href={continueHref}
        >
          Lanjut ke halaman masuk
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Daftar"
      description="Buat akun untuk mulai menyusun undangan pernikahan Anda."
      footer={
        <>
          Sudah punya akun?{" "}
          <a className="focus-ring text-primary-700 underline" href={loginHref}>
            Masuk
          </a>
        </>
      }
    >
      <FormError message={message} />

      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="space-y-4">
          <Input
            label="Nama lengkap"
            name="full_name"
            autoComplete="name"
            required
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
            }}
            error={problem?.field === "full_name" ? problem.message : undefined}
          />

          <Input
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            error={problem?.field === "email" ? problem.message : undefined}
          />

          <Input
            label="Kata sandi"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            // The rules, before the attempt rather than after it. `docs/SECURITY/03`'s
            // policy is enforced server-side; stating it here is what stops a user
            // discovering it by being rejected.
            helperText="Minimal 8 karakter, dengan huruf dan angka."
            error={problem?.field === "password" ? problem.message : undefined}
          />
        </div>

        <Button type="submit" className="mt-6 w-full" loading={submitting}>
          Daftar
        </Button>
      </form>

      {alternatives}
    </AuthShell>
  );
}
