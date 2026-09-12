"use client";

import { useState, type FormEvent } from "react";

import { Button, Input } from "@wi/ui";

import { useAuth } from "../lib/auth";
import {
  formatWait,
  toFriendlyError,
  type FriendlyError,
} from "../lib/error-messages";
import { AuthShell, FormError } from "./AuthShell";

/**
 * P1-20 — sign in. `docs/API/01`, `docs/UI-UX/05` § Auth.
 *
 * Extracted from the route file so it can be rendered in a component test without Next's
 * router: the page supplies `next` and `onAuthenticated`, this owns the form. The DoD asks
 * for a test proving no token reaches storage after a login, and that test needs to drive a
 * real submit against a real client.
 */

export interface LoginFormProps {
  /** Where to go afterwards. Already validated by `safeNext` at the page level. */
  readonly onAuthenticated: (user: { email_verified: boolean }) => void;
  readonly registerHref: string;
  readonly forgotHref: string;
  /** Rendered under the form. Google sign-in lives here when it is configured. */
  readonly alternatives?: React.ReactNode;
}

export function LoginForm({
  onAuthenticated,
  registerHref,
  forgotHref,
  alternatives,
}: LoginFormProps) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<FriendlyError | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setProblem(undefined);
    setSubmitting(true);

    try {
      const user = await login(email, password);
      onAuthenticated(user);
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

  return (
    <AuthShell
      title="Masuk"
      description="Masuk untuk melanjutkan membuat undangan Anda."
      footer={
        <>
          Belum punya akun?{" "}
          <a
            className="focus-ring text-primary-700 underline"
            href={registerHref}
          >
            Daftar
          </a>
        </>
      }
    >
      <FormError message={message} />

      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="space-y-4">
          <Input
            label="Email"
            type="email"
            name="email"
            // The browser's own credential handling. Without these a password manager
            // cannot fill the form, and users respond to that by choosing simpler
            // passwords -- which is a security outcome, not a convenience one.
            autoComplete="username"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            // The field-level error only when the server blamed a field. A wrong password
            // is not an email problem, and marking the email invalid for it would tell the
            // user the address was wrong -- which is the enumeration hint docs/API/01
            // removes on purpose.
            error={problem?.field === "email" ? problem.message : undefined}
          />

          <Input
            label="Kata sandi"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            error={problem?.field === "password" ? problem.message : undefined}
          />
        </div>

        <div className="mt-2 text-right text-sm">
          <a
            className="focus-ring text-primary-700 underline"
            href={forgotHref}
          >
            Lupa kata sandi?
          </a>
        </div>

        {/*
         * `loading`, never `disabled`. `@wi/ui`'s Button uses `aria-disabled` and swallows
         * the click so the element keeps focus -- a `disabled` submit button drops focus to
         * the top of the document, and a keyboard user who just pressed Enter has no idea
         * what happened.
         */}
        <Button type="submit" className="mt-6 w-full" loading={submitting}>
          Masuk
        </Button>
      </form>

      {alternatives}
    </AuthShell>
  );
}
