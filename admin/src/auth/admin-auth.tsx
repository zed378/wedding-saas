import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { accessTokenStore, ApiClient } from "@wi/api-client";

/**
 * docs/SECURITY/03 § Admin Session:
 * Admin session lifespan is strictly capped at 4 hours maximum.
 */
export const MAX_ADMIN_SESSION_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface AdminUser {
  id: string;
  email: string;
  role: "admin" | "super_admin" | "user" | string;
  name?: string;
}

export interface AdminAuthContextValue {
  user: AdminUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isUnauthorized: boolean;
  isLoading: boolean;
  sessionExpiresAt: number | null;
  remainingMinutes: number;
  login: (token: string, user: AdminUser) => void;
  logout: () => void;
  checkSession: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({
  children,
  initialUser = null,
  initialSessionExpiresAt = null,
}: {
  children: ReactNode;
  initialUser?: AdminUser | null;
  initialSessionExpiresAt?: number | null;
}) {
  const [user, setUser] = useState<AdminUser | null>(initialUser);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(
    initialSessionExpiresAt,
  );
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    if (initialUser) return false;
    if (typeof window !== "undefined") {
      return !!accessTokenStore.get();
    }
    return false;
  });

  const isAuthenticated = user !== null;
  const isAdmin =
    user !== null && (user.role === "admin" || user.role === "super_admin");
  const isUnauthorized = user !== null && !isAdmin;

  // Calculate remaining minutes in current session
  const remainingMinutes = sessionExpiresAt
    ? Math.max(0, Math.floor((sessionExpiresAt - Date.now()) / (60 * 1000)))
    : 0;

  const logout = useCallback(() => {
    accessTokenStore.clear();
    setUser(null);
    setSessionExpiresAt(null);
  }, []);

  const login = useCallback((token: string, newUser: AdminUser) => {
    accessTokenStore.set(token);
    const expiresAt = Date.now() + MAX_ADMIN_SESSION_MS;
    setUser(newUser);
    setSessionExpiresAt(expiresAt);
  }, []);

  const checkSession = useCallback(async () => {
    setIsLoading(true);
    try {
      // If session expiry has passed, log out immediately
      if (sessionExpiresAt && Date.now() >= sessionExpiresAt) {
        logout();
        setIsLoading(false);
        return;
      }

      const client = new ApiClient({
        baseUrl:
          typeof window !== "undefined" && window.location.hostname === "localhost"
            ? "http://localhost:3000"
            : "",
        tokenStore: accessTokenStore,
      });

      const res = await client.get<AdminUser>("/api/v1/auth/me");
      if (res && res.data) {
        setUser(res.data);
        if (!sessionExpiresAt) {
          setSessionExpiresAt(Date.now() + MAX_ADMIN_SESSION_MS);
        }
      } else {
        logout();
      }
    } catch {
      // If network fails or token is missing, session cannot be verified
      logout();
    } finally {
      setIsLoading(false);
    }
  }, [logout, sessionExpiresAt]);

  // Check 4-hour session expiry ticker
  useEffect(() => {
    if (!sessionExpiresAt) return;

    const interval = setInterval(() => {
      if (Date.now() >= sessionExpiresAt) {
        logout();
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [sessionExpiresAt, logout]);

  // Initial session verification if token is present
  useEffect(() => {
    if (!initialUser) {
      const currentToken = accessTokenStore.get();
      if (currentToken) {
        void checkSession();
      } else {
        setIsLoading(false);
      }
    }
  }, [initialUser, checkSession]);

  return (
    <AdminAuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isAdmin,
        isUnauthorized,
        isLoading,
        sessionExpiresAt,
        remainingMinutes,
        login,
        logout,
        checkSession,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error("useAdminAuth must be used within an AdminAuthProvider");
  }
  return context;
}
