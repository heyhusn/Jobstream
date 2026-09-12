import { Suspense } from "react";
import { NavLink, Outlet } from "react-router-dom";
import clsx from "clsx";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useAdmin";
import { useTheme, type ThemeChoice } from "@/hooks/useTheme";
import { CreditChip } from "@/components/ui/CreditChip";
import { NotificationBell } from "@/components/layout/NotificationBell";

const links = [
  { to: "/matches", label: "Matches" },
  { to: "/search", label: "Search" },
  { to: "/tracker", label: "Tracker" },
  { to: "/companies", label: "Companies" },
  { to: "/salary", label: "Salary" },
  { to: "/alerts", label: "Alerts" },
  { to: "/analytics", label: "Analytics" },
  { to: "/skills", label: "Skills" },
  { to: "/settings", label: "Settings" },
  { to: "/settings/billing", label: "Billing" },
];

function PageFallback() {
  return (
    <div className="grid min-h-[50vh] place-items-center" aria-hidden="true">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-rule border-t-ink-70" />
    </div>
  );
}

const THEME_CYCLE: ThemeChoice[] = ["system", "light", "dark"];
const THEME_LABEL: Record<ThemeChoice, string> = { system: "Auto", light: "Light", dark: "Dark" };

/** Minor m33: a three-way cycle, not a binary switch — "system" stays the default. */
function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length])}
      title="Theme: light, dark, or match your system"
      className="rounded-app border border-rule px-2.5 py-1.5 text-xs font-medium text-ink-70 transition-colors hover:border-ink hover:text-ink"
    >
      {THEME_LABEL[theme]}
    </button>
  );
}

export function AppShell() {
  const { signOut } = useAuth();
  // Server-side RPCs are the real gate (see is_admin() in
  // 0020_admin_console.sql) — this only decides whether to show a
  // link that would otherwise 403 for everyone else.
  const { data: isAdmin } = useIsAdmin();
  const visibleLinks = isAdmin ? [...links, { to: "/admin", label: "Admin" }] : links;

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 border-b border-rule bg-paper/90 backdrop-blur-sm">
        <div className="mx-auto flex h-[62px] max-w-[1180px] items-center gap-6 px-6">
          <span className="mr-auto font-display text-lg font-bold tracking-tight">
            job<span className="text-live">spy</span>
          </span>
          <nav className="hidden items-center gap-6 sm:flex">
            {visibleLinks.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === "/settings"}
                className={({ isActive }) =>
                  clsx(
                    "border-b-[1.5px] border-transparent pb-0.5 text-sm text-ink-70 transition-colors hover:text-ink",
                    isActive && "border-ink text-ink"
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <ThemeToggle />
          <NotificationBell />
          <CreditChip />
          <button
            onClick={() => signOut()}
            className="text-sm text-ink-45 transition-colors hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-6 py-10">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
