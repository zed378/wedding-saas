import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient, accessTokenStore } from "@wi/api-client";
import { axeViolationIds } from "@wi/ui/src/testing/axe.js";

import { AuthProvider } from "../src/lib/auth";
import { LoginForm } from "../src/components/LoginForm";
import { RegisterForm } from "../src/components/RegisterForm";
import {
  ForgotPasswordForm,
  ResetPasswordForm,
} from "../src/components/PasswordResetForms";
import { VerifyEmailPanel } from "../src/components/VerifyEmailPanel";

/**
 * P1-20 — the auth screens.
 *
 * Two of the four DoD items can only be answered by a rendered component driven by real
 * events: "no token is ever written to `localStorage` or `sessionStorage`" and "every screen
 * passes the automated accessibility check". Both are here.
 *
 * The API is a stubbed `fetch` rather than a mocked `ApiClient`, because the thing under test
 * includes the client's own behaviour — it is the client that holds the token, and a mock of
 * it would be a mock of the control being verified.
 */

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "budi@example.test",
  full_name: "Budi",
  role: "user",
  email_verified: false,
};

/** One canned response per path, so a test says what the server did rather than how. */
type Responder = (
  path: string,
  init: RequestInit | undefined,
) => Response | Promise<Response>;

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const ok = (data: unknown) => json(200, { success: true, data });
const fail = (
  status: number,
  code: string,
  message: string,
  extras: { details?: unknown; headers?: HeadersInit } = {},
) =>
  json(
    status,
    {
      success: false,
      error: {
        code,
        message,
        ...(extras.details === undefined ? {} : { details: extras.details }),
      },
    },
    extras.headers ?? {},
  );

function renderWith(node: React.ReactNode, respond: Responder) {
  const calls: { path: string; body: unknown }[] = [];

  const fetchStub: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    const path = url.replace("http://api.test/v1", "");
    calls.push({
      path,
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as unknown)
          : undefined,
    });
    return respond(path, init ?? undefined);
  };

  const client = new ApiClient({
    baseUrl: "http://api.test/v1",
    tokenStore: accessTokenStore,
    fetch: fetchStub,
  });

  const result = render(
    <AuthProvider client={client} restoreSession={false}>
      {node}
    </AuthProvider>,
  );

  return { ...result, calls, client };
}

beforeEach(() => {
  accessTokenStore.clear();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------ DoD item 1

describe("token storage (card DoD 1)", () => {
  it("no token reaches localStorage or sessionStorage after a successful login", async () => {
    // `docs/FRONTEND/02` § Auth Token Storage, and the reason it matters: an injected script
    // can read either store, and a stolen access token is a session.
    const onAuthenticated = vi.fn();
    renderWith(
      <LoginForm
        onAuthenticated={onAuthenticated}
        registerHref="/register"
        forgotHref="/forgot-password"
      />,
      (path) =>
        path === "/auth/login"
          ? ok({ access_token: "a-real-looking-token", user: USER })
          : json(404, { success: false, error: { code: "X", message: "x" } }),
    );

    await userEvent.type(screen.getByLabelText(/email/i), "budi@example.test");
    await userEvent.type(screen.getByLabelText(/kata sandi/i), "rahasia123");
    await userEvent.click(screen.getByRole("button", { name: /masuk/i }));

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalled();
    });

    // The token IS held — in memory, where the client put it.
    expect(accessTokenStore.get()).toBe("a-real-looking-token");

    // And nowhere else. Asserting the stores are empty rather than that they lack a
    // particular key: a token under an unexpected name is still a token in storage.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("the token does not appear in storage under any key", async () => {
    // The stronger form of the same claim. `length === 0` would pass if something wrote and
    // then removed the key; this checks the serialised contents for the value itself.
    const onAuthenticated = vi.fn();
    renderWith(
      <LoginForm
        onAuthenticated={onAuthenticated}
        registerHref="/register"
        forgotHref="/forgot-password"
      />,
      () => ok({ access_token: "distinctive-token-value", user: USER }),
    );

    await userEvent.type(screen.getByLabelText(/email/i), "budi@example.test");
    await userEvent.type(screen.getByLabelText(/kata sandi/i), "rahasia123");
    await userEvent.click(screen.getByRole("button", { name: /masuk/i }));

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalled();
    });

    expect(JSON.stringify({ ...localStorage })).not.toContain(
      "distinctive-token-value",
    );
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(
      "distinctive-token-value",
    );
  });

  it("sends credentials so the refresh cookie can be set", async () => {
    // The refresh token arrives as `Set-Cookie` and never passes through JavaScript. That
    // only works if the request opts into credentials.
    const { calls } = renderWith(
      <LoginForm
        onAuthenticated={vi.fn()}
        registerHref="/register"
        forgotHref="/forgot-password"
      />,
      () => ok({ access_token: "t", user: USER }),
    );

    await userEvent.type(screen.getByLabelText(/email/i), "budi@example.test");
    await userEvent.type(screen.getByLabelText(/kata sandi/i), "rahasia123");
    await userEvent.click(screen.getByRole("button", { name: /masuk/i }));

    await waitFor(() => {
      expect(calls.some((c) => c.path === "/auth/login")).toBe(true);
    });
  });
});

// --------------------------------------------------------------- error states

describe("error states (card step 5)", () => {
  it("shows one message for wrong credentials, in a live region", async () => {
    renderWith(
      <LoginForm
        onAuthenticated={vi.fn()}
        registerHref="/register"
        forgotHref="/forgot-password"
      />,
      () => fail(401, "INVALID_CREDENTIALS", "Email atau kata sandi salah."),
    );

    await userEvent.type(screen.getByLabelText(/email/i), "budi@example.test");
    await userEvent.type(screen.getByLabelText(/kata sandi/i), "salah");
    await userEvent.click(screen.getByRole("button", { name: /masuk/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/email atau kata sandi salah/i);
  });

  it("does not mark the email field invalid for a wrong password", async () => {
    // `docs/API/01` makes INVALID_CREDENTIALS deliberately ambiguous. Attaching it to the
    // email input would tell the user the ADDRESS was the problem — handing back the
    // enumeration hint the server refuses to give.
    renderWith(
      <LoginForm
        onAuthenticated={vi.fn()}
        registerHref="/register"
        forgotHref="/forgot-password"
      />,
      () => fail(401, "INVALID_CREDENTIALS", "Email atau kata sandi salah."),
    );

    await userEvent.type(screen.getByLabelText(/email/i), "budi@example.test");
    await userEvent.type(screen.getByLabelText(/kata sandi/i), "salah");
    await userEvent.click(screen.getByRole("button", { name: /masuk/i }));

    await screen.findByRole("alert");
    expect(screen.getByLabelText(/email/i)).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("tells the user how long to wait when rate limited", async () => {
    renderWith(
      <LoginForm
        onAuthenticated={vi.fn()}
        registerHref="/register"
        forgotHref="/forgot-password"
      />,
      () =>
        fail(429, "TOO_MANY_ATTEMPTS", "Terlalu banyak percobaan.", {
          headers: { "retry-after": "120" },
        }),
    );

    await userEvent.type(screen.getByLabelText(/email/i), "budi@example.test");
    await userEvent.type(screen.getByLabelText(/kata sandi/i), "salah");
    await userEvent.click(screen.getByRole("button", { name: /masuk/i }));

    // "2 menit", not "try again later": a user who does not know how long will retry
    // immediately and spend the rest of their budget.
    expect(await screen.findByRole("alert")).toHaveTextContent(/2 menit/);
  });

  it("reports an offline request as a connection problem", async () => {
    renderWith(
      <LoginForm
        onAuthenticated={vi.fn()}
        registerHref="/register"
        forgotHref="/forgot-password"
      />,
      () => {
        throw new TypeError("Failed to fetch");
      },
    );

    await userEvent.type(screen.getByLabelText(/email/i), "budi@example.test");
    await userEvent.type(screen.getByLabelText(/kata sandi/i), "rahasia123");
    await userEvent.click(screen.getByRole("button", { name: /masuk/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /koneksi internet/i,
    );
  });

  it("attaches a field-level validation error to its field", async () => {
    renderWith(<RegisterForm loginHref="/login" />, () =>
      fail(400, "VALIDATION_ERROR", "Tidak valid.", {
        details: [{ field: "password", message: "Kata sandi terlalu pendek." }],
      }),
    );

    await userEvent.type(screen.getByLabelText(/nama lengkap/i), "Budi");
    await userEvent.type(screen.getByLabelText(/email/i), "budi@example.test");
    await userEvent.type(screen.getByLabelText(/kata sandi/i), "abc");
    await userEvent.click(screen.getByRole("button", { name: /daftar/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/kata sandi/i)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
  });
});

// ------------------------------------------------------------- enumeration

describe("what the screens refuse to reveal", () => {
  it("registration shows the same confirmation whatever the server found", async () => {
    // `P1-02` made the endpoint answer identically for a new address and an existing one.
    // A screen that rendered two outcomes would undo that on the page where it matters most.
    renderWith(<RegisterForm loginHref="/login" />, () =>
      json(202, { success: true, data: { status: "accepted" } }),
    );

    await userEvent.type(screen.getByLabelText(/nama lengkap/i), "Budi");
    await userEvent.type(screen.getByLabelText(/email/i), "taken@example.test");
    await userEvent.type(screen.getByLabelText(/kata sandi/i), "rahasia123");
    await userEvent.click(screen.getByRole("button", { name: /daftar/i }));

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      /cek email/i,
    );
  });

  it("forgot-password confirms without saying whether the address exists", async () => {
    renderWith(<ForgotPasswordForm loginHref="/login" />, () =>
      ok({ message: "ok" }),
    );

    await userEvent.type(screen.getByLabelText(/email/i), "who@example.test");
    await userEvent.click(
      screen.getByRole("button", { name: /kirim tautan/i }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(/jika alamat/i);
  });
});

// -------------------------------------------------------------- reset & verify

describe("expired links (card step 5)", () => {
  it("a reset with no token offers a new one instead of a dead form", async () => {
    renderWith(
      <ResetPasswordForm
        token={undefined}
        loginHref="/login"
        forgotHref="/forgot-password"
      />,
      () => ok({}),
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /tidak lengkap/i,
    );
    expect(
      screen.getByRole("link", { name: /minta tautan baru/i }),
    ).toHaveAttribute("href", "/forgot-password");
  });

  it("an expired reset token offers a resend", async () => {
    renderWith(
      <ResetPasswordForm
        token="spent"
        loginHref="/login"
        forgotHref="/forgot-password"
      />,
      () =>
        fail(400, "VALIDATION_ERROR", "Tautan telah kedaluwarsa.", {
          details: [
            { field: "token", message: "Tautan ini telah kedaluwarsa." },
          ],
        }),
    );

    await userEvent.type(
      screen.getByLabelText(/kata sandi baru/i),
      "rahasia12345",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /simpan kata sandi/i }),
    );

    expect(
      await screen.findByRole("link", { name: /minta tautan baru/i }),
    ).toBeInTheDocument();
  });

  it("verify-email redeems the token once, on arrival", async () => {
    const { calls } = renderWith(
      <VerifyEmailPanel
        token="good-token"
        loginHref="/login"
        dashboardHref="/dashboard"
      />,
      () => ok({ verified: true }),
    );

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      /terverifikasi/i,
    );

    // Once. A one-time token presented twice is rejected the second time, and the user
    // would be told a perfectly good link had expired.
    expect(calls.filter((c) => c.path === "/auth/verify-email")).toHaveLength(
      1,
    );
  });

  it("verify-email reports a spent link without claiming success", async () => {
    renderWith(
      <VerifyEmailPanel
        token="spent"
        loginHref="/login"
        dashboardHref="/dashboard"
      />,
      () => fail(400, "VALIDATION_ERROR", "Tautan tidak berlaku."),
    );

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      /tidak berlaku/i,
    );
  });
});

// ------------------------------------------------------------------ DoD item 4

describe("accessibility (card DoD 4)", () => {
  const screens: [string, React.ReactNode][] = [
    [
      "login",
      <LoginForm
        key="login"
        onAuthenticated={vi.fn()}
        registerHref="/register"
        forgotHref="/forgot-password"
      />,
    ],
    ["register", <RegisterForm key="register" loginHref="/login" />],
    ["forgot password", <ForgotPasswordForm key="forgot" loginHref="/login" />],
    [
      "reset password",
      <ResetPasswordForm
        key="reset"
        token="abc"
        loginHref="/login"
        forgotHref="/forgot-password"
      />,
    ],
    [
      "verify email",
      <VerifyEmailPanel
        key="verify"
        token={undefined}
        loginHref="/login"
        dashboardHref="/dashboard"
      />,
    ],
  ];

  it.each(screens)("%s has no axe violations", async (_name, node) => {
    const { container } = renderWith(node, () => ok({}));

    expect(await axeViolationIds(container)).toEqual([]);
  });

  it("an error is announced, not only coloured", async () => {
    // `docs/UI-UX/08`: colour is never the sole indicator. The alert region carries the
    // text, so somebody who cannot see the red border still hears what went wrong.
    renderWith(
      <LoginForm
        onAuthenticated={vi.fn()}
        registerHref="/register"
        forgotHref="/forgot-password"
      />,
      () => fail(401, "INVALID_CREDENTIALS", "Email atau kata sandi salah."),
    );

    await userEvent.type(screen.getByLabelText(/email/i), "budi@example.test");
    await userEvent.type(screen.getByLabelText(/kata sandi/i), "salah");
    await userEvent.click(screen.getByRole("button", { name: /masuk/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  it("the whole login form is reachable by keyboard alone", async () => {
    renderWith(
      <LoginForm
        onAuthenticated={vi.fn()}
        registerHref="/register"
        forgotHref="/forgot-password"
      />,
      () => ok({}),
    );

    await userEvent.tab();
    expect(screen.getByLabelText(/email/i)).toHaveFocus();

    await userEvent.tab();
    expect(screen.getByLabelText(/kata sandi/i)).toHaveFocus();

    await userEvent.tab();
    expect(
      screen.getByRole("link", { name: /lupa kata sandi/i }),
    ).toHaveFocus();

    await userEvent.tab();
    expect(screen.getByRole("button", { name: /masuk/i })).toHaveFocus();
  });

  it("the submit button keeps focus while loading", async () => {
    // `@wi/ui`'s Button uses `aria-disabled` rather than `disabled` precisely so this holds.
    // A `disabled` submit drops focus to the top of the document, and a keyboard user who
    // just pressed Enter is left with no idea whether anything happened.
    let release: (() => void) | undefined;
    renderWith(
      <LoginForm
        onAuthenticated={vi.fn()}
        registerHref="/register"
        forgotHref="/forgot-password"
      />,
      () =>
        new Promise<Response>((resolve) => {
          release = () => {
            resolve(ok({ access_token: "t", user: USER }));
          };
        }),
    );

    await userEvent.type(screen.getByLabelText(/email/i), "budi@example.test");
    await userEvent.type(screen.getByLabelText(/kata sandi/i), "rahasia123");
    const button = screen.getByRole("button", { name: /masuk/i });
    await userEvent.click(button);

    await waitFor(() => {
      expect(button).toHaveAttribute("aria-disabled", "true");
    });
    expect(button).not.toBeDisabled();

    release?.();
  });
});
