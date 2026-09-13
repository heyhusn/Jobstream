import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import clsx from "clsx";
import {
  BarChart3,
  Bell,
  BellRing,
  Building2,
  CreditCard,
  DollarSign,
  FileText,
  GraduationCap,
  Kanban,
  Laptop,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Target,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useIsAdmin } from "@/hooks/useAdmin";
import { useTheme, type ThemeChoice } from "@/hooks/useTheme";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { useSystemStatus } from "@/hooks/useSystemStatus";
import { CreditChip } from "@/components/ui/CreditChip";
import { Avatar } from "@/components/ui/Avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { NotificationBell } from "@/components/layout/NotificationBell";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Target;
  end?: boolean;
  flag?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Job search",
    items: [
      { to: "/matches", label: "Matches", icon: Target },
      { to: "/search", label: "Search", icon: Search, flag: "search_page_enabled" },
      { to: "/tracker", label: "Tracker", icon: Kanban },
      { to: "/resumes", label: "Resumes", icon: FileText },
    ],
  },
  {
    label: "Insights",
    items: [
      { to: "/companies", label: "Companies", icon: Building2 },
      { to: "/salary", label: "Salary", icon: DollarSign },
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/skills", label: "Skills", icon: GraduationCap },
    ],
  },
  {
    label: "Account",
    items: [
      { to: "/alerts", label: "Alerts", icon: BellRing },
      { to: "/notifications", label: "Notifications", icon: Bell },
      { to: "/settings", label: "Settings", icon: Settings, end: true },
      { to: "/settings/billing", label: "Billing", icon: CreditCard },
    ],
  },
];

const SIDEBAR_COLLAPSED_KEY = "jobspy-sidebar-collapsed";

function PageFallback() {
  return (
    <div className="grid min-h-[50vh] place-items-center" aria-hidden="true">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-rule border-t-ink-70" />
    </div>
  );
}

const THEME_CYCLE: ThemeChoice[] = ["system", "light", "dark"];
const THEME_ICON: Record<ThemeChoice, typeof Sun> = { system: Laptop, light: Sun, dark: Moon };
const THEME_LABEL: Record<ThemeChoice, string> = { system: "Auto", light: "Light", dark: "Dark" };

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = THEME_ICON[theme];

  return (
    <button
      type="button"
      onClick={() => setTheme(THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length])}
      title={`Theme: ${THEME_LABEL[theme]}`}
      className="flex h-8 w-8 items-center justify-center rounded-app text-ink-70 transition-colors hover:bg-rule-soft hover:text-ink"
    >
      <Icon size={17} />
    </button>
  );
}

/** Minor m40: shown app-wide whenever the operator has flagged anything other than "operational". */
function StatusBanner() {
  const { data } = useSystemStatus();
  if (!data || data.status === "operational") return null;

  return (
    <div
      className={clsx(
        "px-6 py-2 text-center text-sm",
        data.status === "outage" ? "bg-ghost text-paper" : "bg-rule text-ink"
      )}
    >
      {data.status === "outage" ? "Outage" : "Degraded performance"}
      {data.message ? ` — ${data.message}` : ""}
    </div>
  );
}

function SidebarNav({
  groups,
  collapsed,
  onNavigate,
}: {
  groups: NavGroup[];
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group.label}>
          {!collapsed && (
            <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-45">
              {group.label}
            </p>
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-3 rounded-app px-3 py-2 text-sm font-medium transition-colors",
                    collapsed && "justify-center px-0",
                    isActive
                      ? "bg-ink text-paper"
                      : "text-ink-70 hover:bg-rule-soft hover:text-ink"
                  )
                }
              >
                <item.icon size={17} className="shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppShell() {
  const { signOut } = useAuth();
  const { data: profile } = useProfile();
  // Server-side RPCs are the real gate (see is_admin() in
  // 0020_admin_console.sql) — this only decides whether to show a
  // link that would otherwise 403 for everyone else.
  const { data: isAdmin } = useIsAdmin();
  // Minor m36: a flagged-off link disappears from nav, but the route
  // itself isn't removed — presentation-only, same scoping as m19's
  // stage customizer.
  const searchEnabled = useFeatureFlag("search_page_enabled");
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Best-effort; collapse state just won't persist across reloads.
    }
  }, [collapsed]);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    document.body.style.overflow = "hidden";
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onEscape);
    };
  }, [mobileOpen]);

  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.flag || searchEnabled),
  }));
  const visibleGroups = isAdmin
    ? [...groups, { label: "Admin", items: [{ to: "/admin", label: "Admin", icon: ShieldCheck }] }]
    : groups;

  const displayName = profile?.full_name?.trim() || "Account";

  return (
    <div className="min-h-screen bg-paper lg:flex">
      {/* Desktop sidebar */}
      <aside
        className={clsx(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-rule bg-raised transition-[width] lg:flex",
          collapsed ? "w-[68px]" : "w-64"
        )}
      >
        <div className={clsx("flex h-[62px] shrink-0 items-center border-b border-rule", collapsed ? "justify-center" : "justify-between px-4")}>
          {!collapsed && (
            <span className="font-display text-lg font-bold tracking-tight">
              job<span className="text-live">spy</span>
            </span>
          )}
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-app text-ink-45 transition-colors hover:bg-rule-soft hover:text-ink"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <PanelLeftClose size={16} className={clsx("transition-transform", collapsed && "rotate-180")} />
          </button>
        </div>
        <SidebarNav groups={visibleGroups} collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col bg-raised">
            <div className="flex h-[62px] shrink-0 items-center justify-between border-b border-rule px-4">
              <span className="font-display text-lg font-bold tracking-tight">
                job<span className="text-live">spy</span>
              </span>
              <button
                onClick={() => setMobileOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-app text-ink-45 hover:bg-rule-soft hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
            <SidebarNav groups={visibleGroups} collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-h-screen flex-1 flex-col">
        <StatusBanner />
        <header className="sticky top-0 z-40 border-b border-rule bg-paper/90 backdrop-blur-sm">
          <div className="flex h-[62px] items-center gap-3 px-4 sm:px-6">
            <button
              onClick={() => setMobileOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-app text-ink-70 hover:bg-rule-soft hover:text-ink lg:hidden"
              aria-label="Open menu"
            >
              <Menu size={19} />
            </button>
            <span className="font-display text-base font-bold tracking-tight lg:hidden">
              job<span className="text-live">spy</span>
            </span>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              <NotificationBell />
              <CreditChip />
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-2 rounded-app p-1 transition-colors hover:bg-rule-soft">
                  <Avatar name={displayName} size="sm" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-medium">{displayName}</p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <NavLink to="/settings" className="flex items-center gap-2">
                      <Settings size={15} /> Settings
                    </NavLink>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <NavLink to="/settings/billing" className="flex items-center gap-2">
                      <CreditCard size={15} /> Billing
                    </NavLink>
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem asChild>
                      <NavLink to="/admin" className="flex items-center gap-2">
                        <ShieldCheck size={15} /> Admin
                      </NavLink>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => signOut()}>
                    <LogOut size={15} /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-8 sm:px-6 sm:py-10">
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
