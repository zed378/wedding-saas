"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../lib/auth";
import { toFriendlyError } from "../lib/error-messages";
import { FormError } from "./AuthShell";

/**
 * P1-20 — Google sign-in. `docs/API/01` § Google OAuth, `P1-04`.
 *
 * ## The frontend's whole job is to obtain an `id_token` and post it
 *
 * It does not read the email out of the token, does not decode it, and does not decide
 * whether the address is verified. `P1-04` is emphatic about this and its record says why:
 * the backend verifies the signature with Google and takes the email from the **verified**
 * claims, because anything the frontend extracted would be attacker-supplied by the time it
 * arrived. So the token is opaque here, and the only thing this component knows about it is
 * that it is a string.
 *
 * ## It renders nothing when unconfigured
 *
 * Without `NEXT_PUBLIC_GOOGLE_CLIENT_ID` there is no Google sign-in, and a button that
 * cannot work is worse than no button: it is a dead end on the login page. Absent, not
 * disabled.
 */

interface GoogleCredentialResponse {
  readonly credential?: string;
}

interface GoogleIdApi {
  readonly initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }) => void;
  readonly renderButton: (
    parent: HTMLElement,
    options: Record<string, string>,
  ) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
}

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

export function GoogleSignIn({
  onAuthenticated,
}: {
  readonly onAuthenticated: () => void;
}) {
  const { loginWithGoogle } = useAuth();
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const container = useRef<HTMLDivElement | null>(null);
  const clientId = process.env["NEXT_PUBLIC_GOOGLE_CLIENT_ID"];

  const handleCredential = useCallback(
    (response: GoogleCredentialResponse) => {
      const credential = response.credential;
      if (typeof credential !== "string" || credential.length === 0) {
        setProblem("Google tidak memberikan kredensial. Coba lagi.");
        return;
      }

      void (async () => {
        try {
          // Straight through, unread. See the note above.
          await loginWithGoogle(credential);
          onAuthenticated();
        } catch (error) {
          setProblem(toFriendlyError(error).message);
        }
      })();
    },
    [loginWithGoogle, onAuthenticated],
  );

  useEffect(() => {
    if (clientId === undefined || clientId.length === 0) return;
    if (container.current === null) return;

    const parent = container.current;

    const render = () => {
      const api = window.google?.accounts?.id;
      if (api === undefined) return;

      api.initialize({ client_id: clientId, callback: handleCredential });
      api.renderButton(parent, {
        type: "standard",
        theme: "outline",
        size: "large",
        width: "100%",
        // Google renders its own button in an iframe and owns its accessible name. `locale`
        // is set so the label matches the rest of the page rather than defaulting to the
        // browser's language -- `docs/UI-UX/17` wants one language per page.
        locale: "id",
        text: "signin_with",
      });
    };

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    if (existing !== null) {
      render();
      return;
    }

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = render;
    document.head.append(script);
  }, [clientId, handleCredential]);

  if (clientId === undefined || clientId.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center gap-3 text-xs text-text-muted">
        <span className="h-px flex-1 bg-border" />
        atau
        <span className="h-px flex-1 bg-border" />
      </div>

      <FormError message={problem} />
      <div ref={container} />
    </div>
  );
}
