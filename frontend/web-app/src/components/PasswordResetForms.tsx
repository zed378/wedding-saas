"use client";

import { useState, type FormEvent } from "react";

import { Button, Input } from "@wi/ui";

import { useAuth } from "../lib/auth";
import {
  formatWait,
  toFriendlyError,
  type FriendlyError,
} from "../lib/error-messages";
import { AuthShell, FormError, FormStatus } from "./AuthShell";

/**
 * P1-20 — forgetting and resetting a password. `docs/API/01`, `P1-05`.
 *
 * Both screens are here because they are two halves of one flow and share the rule that
 * matters: **neither of them ever reveals whether an address is registered.** The request
 * screen shows the same confirmation for any well-formed address — matching the server, which
 * returns the same 200 either way — and the reset screen speaks only about the token.
 */

function withWait(problem: FriendlyError | undefined): string | undefined {
  if (problem === undefined) return undefined;
  return problem.retryAfterSeconds === undefined
    ? problem.message
    : `${problem.message} Coba lagi dalam ${formatWait(problem.retryAfterSeconds)}.`;
}

export function ForgotPasswordForm({
  loginHref,
}: {
  readonly loginHref: string;
}) {
  const { api } = useAuth();
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<FriendlyError | undefined>(undefined);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setProblem(undefined);
    setSubmitting(true);

    try {
      await api.request("/auth/forgot-password", {
        method: "POST",
        body: { email },
        anonymous: true,
      });
      setSent(true);
    } catch (error) {
      setProblem(toFriendlyError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Lupa kata sandi"
      description="Masukkan email Anda dan kami akan mengirim tautan untuk mengatur ulang kata sandi."
      footer={
        <a className="focus-ring text-primary-700 underline" href={loginHref}>
          Kembali ke halaman masuk
        </a>
      }
    >
      <FormError message={withWait(problem)} />
      {/*
       * The same confirmation for every address, matching the server's own 200. A screen
       * that said "we don't have that email" would be a user-enumeration oracle, and it
       * would be one on the page most useful to somebody probing for accounts.
       */}
      <FormStatus
        message={
          sent
            ? "Jika alamat tersebut terdaftar, kami telah mengirim tautan untuk mengatur ulang kata sandi."
            : undefined
        }
      />

      <form onSubmit={(e) => void onSubmit(e)} noValidate>
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

        <Button type="submit" className="mt-6 w-full" loading={submitting}>
          Kirim tautan
        </Button>
      </form>
    </AuthShell>
  );
}

export interface ResetPasswordFormProps {
  /** From the emailed link. Absent means the user arrived without one. */
  readonly token: string | undefined;
  readonly loginHref: string;
  readonly forgotHref: string;
}

export function ResetPasswordForm({
  token,
  loginHref,
  forgotHref,
}: ResetPasswordFormProps) {
  const { api } = useAuth();
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<FriendlyError | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // No token at all: there is nothing to submit, and a form that could not work is worse
  // than a page that says so and offers the way back.
  if (token === undefined || token.length === 0) {
    return (
      <AuthShell
        title="Tautan tidak lengkap"
        description="Tautan pengaturan ulang tidak valid. Minta tautan baru untuk melanjutkan."
      >
        <a
          className="focus-ring inline-flex w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-text-inverse hover:bg-primary-700"
          href={forgotHref}
        >
          Minta tautan baru
        </a>
      </AuthShell>
    );
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setProblem(undefined);
    setSubmitting(true);

    try {
      await api.request("/auth/reset-password", {
        method: "POST",
        body: { token, new_password: password },
        anonymous: true,
      });
      setDone(true);
    } catch (error) {
      setProblem(toFriendlyError(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <AuthShell
        title="Kata sandi diperbarui"
        description="Semua sesi lain telah diakhiri. Masuk kembali dengan kata sandi baru Anda."
      >
        <FormStatus message="Kata sandi Anda berhasil diperbarui." />
        <a
          className="focus-ring mt-6 inline-flex w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-text-inverse hover:bg-primary-700"
          href={loginHref}
        >
          Masuk
        </a>
      </AuthShell>
    );
  }

  // `P1-05` answers an expired or spent token with a `token` field error. Offering the
  // resend action beside it is what card step 5 asks for -- without it the user is told the
  // link is dead and left to find the forgot-password page themselves.
  const expired = problem?.field === "token";

  return (
    <AuthShell
      title="Atur ulang kata sandi"
      description="Pilih kata sandi baru untuk akun Anda."
      footer={
        expired ? (
          <a
            className="focus-ring text-primary-700 underline"
            href={forgotHref}
          >
            Minta tautan baru
          </a>
        ) : (
          <a className="focus-ring text-primary-700 underline" href={loginHref}>
            Kembali ke halaman masuk
          </a>
        )
      }
    >
      <FormError message={withWait(problem)} />

      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <Input
          label="Kata sandi baru"
          type="password"
          name="new_password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          helperText="Minimal 8 karakter, dengan huruf dan angka."
          error={
            problem?.field === "new_password" ? problem.message : undefined
          }
        />

        <Button type="submit" className="mt-6 w-full" loading={submitting}>
          Simpan kata sandi
        </Button>
      </form>
    </AuthShell>
  );
}
