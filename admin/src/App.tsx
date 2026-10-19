import { AdminAuthProvider } from "./auth/admin-auth.js";
import { RequireAdmin } from "./auth/RequireAdmin.js";
import { RouterProvider, useRouter } from "./router.js";
import { LoginPage } from "./pages/LoginPage.js";
import { UnauthorizedPage } from "./pages/UnauthorizedPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { UsersPage } from "./pages/UsersPage.js";
import { TemplatesPage } from "./pages/TemplatesPage.js";
import { OrdersPage } from "./pages/OrdersPage.js";
import { ModerationPage } from "./pages/ModerationPage.js";
import { AuditLogsPage } from "./pages/AuditLogsPage.js";

/**
 * P0-22 / P5-01 — The admin application shell.
 *
 * Dedicated SPA served on admin.vizunicum.my.id (port 3300 locally).
 * Runs on a completely separate hostname and trust boundary from the user app (docs/SECURITY/02),
 * with in-memory access tokens, max 4-hour session lifespan, desktop-first navigation,
 * and an explicit Unauthorized page when a non-admin account is detected.
 */
export function AppRoutes() {
  const { path } = useRouter();

  // Public / unauthenticated route
  if (path === "/login") {
    return <LoginPage />;
  }

  // Explicit Unauthorized page (BR-Admin.2)
  if (path === "/unauthorized") {
    return <UnauthorizedPage />;
  }

  // All administrative routes wrapped in RequireAdmin guard
  return (
    <RequireAdmin>
      {path === "/users" || path.startsWith("/users/") ? (
        <UsersPage />
      ) : path === "/templates" || path.startsWith("/templates/") ? (
        <TemplatesPage />
      ) : path === "/orders" || path.startsWith("/orders/") ? (
        <OrdersPage />
      ) : path === "/moderation" || path.startsWith("/moderation/") ? (
        <ModerationPage />
      ) : path === "/audit-logs" || path.startsWith("/audit-logs/") ? (
        <AuditLogsPage />
      ) : (
        <DashboardPage />
      )}
    </RequireAdmin>
  );
}

export function App() {
  return (
    <AdminAuthProvider>
      <RouterProvider>
        <AppRoutes />
      </RouterProvider>
    </AdminAuthProvider>
  );
}
