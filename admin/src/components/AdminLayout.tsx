import { type ReactNode } from "react";
import { Avatar, Badge, Button } from "@wi/ui";
import { useAdminAuth } from "../auth/admin-auth.js";
import { useRouter, Link } from "../router.js";

interface NavItem {
  name: string;
  href: string;
  matchPrefix?: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { name: "Dashboard", href: "/", icon: "📊" },
  { name: "Pengguna", href: "/users", matchPrefix: "/users", icon: "👥" },
  { name: "Templat", href: "/templates", matchPrefix: "/templates", icon: "🎨" },
  { name: "Pesanan", href: "/orders", matchPrefix: "/orders", icon: "💳" },
  { name: "Moderasi", href: "/moderation", matchPrefix: "/moderation", icon: "🛡️" },
  { name: "Log Audit", href: "/audit-logs", matchPrefix: "/audit-logs", icon: "📜" },
];

export function AdminLayout({ children }: { children: ReactNode }) {
  const { user, remainingMinutes, logout } = useAdminAuth();
  const { path, navigate } = useRouter();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const hoursLeft = Math.floor(remainingMinutes / 60);
  const minsLeft = remainingMinutes % 60;

  return (
    <div className="flex min-h-screen bg-surface text-text">
      {/* Skip to main content link for screen-reader & keyboard accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:p-4 focus:text-text focus:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-600"
      >
        Lewati ke konten utama
      </a>

      {/* Desktop Sidebar (docs/UI-UX/15 § Admin Panel: desktop-first) */}
      <aside
        aria-label="Navigasi Admin"
        className="hidden w-64 flex-col border-r border-border bg-surface-raised md:flex"
      >
        {/* Brand header */}
        <div className="flex h-16 items-center gap-3 border-b border-border px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-600 text-body font-bold text-text-inverse">
            V
          </div>
          <div className="flex flex-col">
            <span className="text-body font-bold text-text">Vizunicum Admin</span>
            <span className="text-body-sm text-text-muted">Panel Manajemen</span>
          </div>
        </div>

        {/* Navigation list */}
        <nav aria-label="Navigasi Admin" className="flex-1 space-y-1 p-4">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/"
                ? path === "/" || path === "/dashboard"
                : item.matchPrefix
                  ? path.startsWith(item.matchPrefix)
                  : path === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-body transition-colors ${
                  isActive
                    ? "bg-primary-50 font-medium text-primary-700"
                    : "text-text-muted hover:bg-surface-sunken hover:text-text"
                }`}
              >
                <span className="text-body-lg" aria-hidden="true">
                  {item.icon}
                </span>
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Session expiry badge in sidebar */}
        <div className="border-t border-border p-4">
          <div className="flex flex-col gap-1 rounded-md bg-surface-sunken p-3">
            <span className="text-body-sm font-medium text-text-muted">
              Batas Sesi (Maks 4 Jam)
            </span>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-success-600" />
              <span className="text-body-sm text-text">
                {hoursLeft} jam {minsLeft} mnt tersisa
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col">
        {/* Top Header */}
        <header className="flex h-16 items-center justify-between border-b border-border bg-surface-raised px-6">
          {/* Breadcrumb or current area info */}
          <div className="flex items-center gap-2 text-body font-medium text-text">
            <span>Admin</span>
            <span className="text-text-muted">/</span>
            <span className="capitalize">
              {NAV_ITEMS.find((item) =>
                item.href === "/"
                  ? path === "/" || path === "/dashboard"
                  : path.startsWith(item.href),
              )?.name || "Halaman"}
            </span>
          </div>

          {/* User profile and actions */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <Avatar
                name={user?.name || user?.email || "Admin"}
                size="sm"
              />
              <div className="hidden flex-col sm:flex">
                <span className="text-body-sm font-medium text-text">
                  {user?.name || user?.email}
                </span>
                <span className="text-body-sm text-text-muted">{user?.email}</span>
              </div>
              <Badge tone={user?.role === "super_admin" ? "warning" : "primary"}>
                {user?.role === "super_admin" ? "Super Admin" : "Admin"}
              </Badge>
            </div>

            <Button variant="secondary" size="sm" onClick={handleLogout}>
              Keluar
            </Button>
          </div>
        </header>

        {/* Page Main Content */}
        <main id="main-content" tabIndex={-1} className="flex-1 p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
