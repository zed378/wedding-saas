"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ApiClient,
  accessTokenStore,
  UnauthenticatedError,
} from "@wi/api-client";

/**
 * P1-20 — the session, and where the tokens are.
 *
 * ## The access token lives in memory and nowhere else
 *
 * `docs/FRONTEND/02` § Auth Token Storage, and `scripts/check-token-storage.mjs` fails the
 * build over it. `accessTokenStore` from `@wi/api-client` is a closure over a variable —
 * there is no persistent branch to configure wrongly, and no code in this app reads or
 * writes a token, which is why the guard can be a text check.
 *
 * The cost is real and worth naming: a full page reload loses the access token. That is
 * what `restore()` below is for — it calls `/auth/refresh`, which presents the HTTP-only
 * cookie the browser still has and gets a new access token. The user stays signed in across
 * a reload without anything readable by a script ever being stored.
 *
 * ## The refresh token is never touched by this code
 *
 * It arrives as `Set-Cookie` with `HttpOnly` and leaves the same way. `credentials:
 * "include"` on the fetch is the entire client-side involvement. There is deliberately no
 * variable holding it anywhere in this repository's frontend.
 */

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly full_name: string;
  readonly role: string;
  readonly email_verified: boolean;
}

interface LoginResponse {
  readonly access_token: string;
  readonly user: AuthUser;
}

export type AuthStatus = "restoring" | "authenticated" | "anonymous";

export interface AuthContextValue {
  readonly status: AuthStatus;
  readonly user: AuthUser | undefined;
  readonly api: ApiClient;
  readonly login: (email: string, password: string) => Promise<AuthUser>;
  readonly loginWithGoogle: (idToken: string) => Promise<AuthUser>;
  readonly register: (input: {
    email: string;
    password: string;
    fullName: string;
  }) => Promise<void>;
  readonly logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Where the API lives. From configuration, never a literal (`docs/DEVOPS/02`). */
function baseUrl(): string {
  return (
    process.env["NEXT_PUBLIC_API_BASE_URL"] ?? "http://localhost:3000/api/v1"
  );
}

export interface AuthProviderProps {
  readonly children: ReactNode;
  /** Injected by tests. Production builds one from configuration. */
  readonly client?: ApiClient;
  /**
   * Skip the refresh call on mount.
   *
   * Tests that are not about session restoration start `anonymous` immediately rather than
   * stubbing a refresh they do not care about.
   */
  readonly restoreSession?: boolean;
  readonly onUnauthenticated?: () => void;
}

export function AuthProvider({
  children,
  client,
  restoreSession = true,
  onUnauthenticated,
}: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | undefined>(undefined);
  const [status, setStatus] = useState<AuthStatus>(
    restoreSession ? "restoring" : "anonymous",
  );

  // A ref, so the callback the client holds always sees the current handler rather than the
  // one captured when the client was built.
  const unauthenticated = useRef(onUnauthenticated);
  unauthenticated.current = onUnauthenticated;

  const api = useMemo(
    () =>
      client ??
      new ApiClient({
        baseUrl: baseUrl(),
        tokenStore: accessTokenStore,
        /**
         * The refresh exchange. `docs/API/01` § Token Strategy: the refresh token is in an
         * HTTP-only cookie, so the body is empty and `credentials: "include"` is what
         * actually carries it.
         *
         * Returning `undefined` means the session is genuinely over; the client turns that
         * into an `UnauthenticatedError` once, for every request waiting on it.
         */
        refreshAccessToken: async () => {
          const response = await fetch(`${baseUrl()}/auth/refresh`, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          if (!response.ok) return undefined;

          const body: unknown = await response.json();
          const token = (body as { data?: { access_token?: unknown } } | null)
            ?.data?.access_token;
          return typeof token === "string" ? token : undefined;
        },
        onUnauthenticated: () => {
          accessTokenStore.clear();
          setUser(undefined);
          setStatus("anonymous");
          unauthenticated.current?.();
        },
      }),
    [client],
  );

  /**
   * Restore a session after a page load.
   *
   * The access token did not survive the reload — by design — so this asks the refresh
   * endpoint whether the cookie still holds. A failure is not an error condition: most
   * visitors to `/login` are simply not signed in.
   */
  useEffect(() => {
    if (!restoreSession) return;

    let cancelled = false;

    void (async () => {
      try {
        const me = await api.request<AuthUser>("/auth/me");
        if (!cancelled) {
          setUser(me.data);
          setStatus("authenticated");
        }
      } catch {
        if (!cancelled) {
          setUser(undefined);
          setStatus("anonymous");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, restoreSession]);

  const adopt = useCallback((response: LoginResponse): AuthUser => {
    // The one place a token enters the app, and it goes into the in-memory store.
    accessTokenStore.set(response.access_token);
    setUser(response.user);
    setStatus("authenticated");
    return response.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api.request<LoginResponse>("/auth/login", {
        method: "POST",
        body: { email, password },
        // The login call itself must not carry an Authorization header or try to refresh:
        // a refresh in the middle of a login would recurse.
        anonymous: true,
      });
      return adopt(result.data);
    },
    [api, adopt],
  );

  const loginWithGoogle = useCallback(
    async (idToken: string) => {
      const result = await api.request<LoginResponse>("/auth/oauth/google", {
        method: "POST",
        body: { id_token: idToken },
        anonymous: true,
      });
      return adopt(result.data);
    },
    [api, adopt],
  );

  const register = useCallback(
    async (input: { email: string; password: string; fullName: string }) => {
      // Deliberately does NOT sign the user in. `P1-02` answers a duplicate address with the
      // same 202 as a new one, so a registration response cannot carry a session without
      // telling the caller whether the address was already taken.
      await api.request("/auth/register", {
        method: "POST",
        body: {
          email: input.email,
          password: input.password,
          full_name: input.fullName,
        },
        anonymous: true,
      });
    },
    [api],
  );

  const logout = useCallback(async () => {
    try {
      await api.request("/auth/logout", { method: "POST" });
    } catch (error) {
      // A logout that fails server-side must still end the session locally. The worst case
      // is a refresh cookie that outlives the click, and leaving the user apparently signed
      // in because the network blinked is worse.
      if (!(error instanceof UnauthenticatedError)) {
        // Swallowed on purpose; nothing actionable for the user.
      }
    } finally {
      accessTokenStore.clear();
      setUser(undefined);
      setStatus("anonymous");
    }
  }, [api]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, api, login, loginWithGoogle, register, logout }),
    [status, user, api, login, loginWithGoogle, register, logout],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === undefined) {
    throw new Error("useAuth must be used inside an <AuthProvider>.");
  }
  return value;
}
