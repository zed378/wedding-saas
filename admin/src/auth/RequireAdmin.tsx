import { type ReactNode } from "react";
import { Spinner } from "@wi/ui";
import { useAdminAuth } from "./admin-auth.js";
import { LoginPage } from "../pages/LoginPage.js";
import { UnauthorizedPage } from "../pages/UnauthorizedPage.js";
import { AdminLayout } from "../components/AdminLayout.js";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, isAdmin, isUnauthorized } = useAdminAuth();

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-screen items-center justify-center bg-surface p-6 text-text"
      >
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-body text-text-muted">Memverifikasi sesi administrator...</p>
        </div>
      </div>
    );
  }

  // Not logged in at all -> show login form
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Authenticated, but standard user -> explicit 403 unauthorized page (BR-Admin.2)
  if (isUnauthorized || !isAdmin) {
    return <UnauthorizedPage />;
  }

  // Permitted admin user -> render within desktop shell
  return <AdminLayout>{children}</AdminLayout>;
}
