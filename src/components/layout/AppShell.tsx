import { NavLink, Outlet } from "react-router-dom";
import clsx from "clsx";
import { useAuth } from "@/hooks/useAuth";
import { CreditChip } from "@/components/ui/CreditChip";

const links = [
  { to: "/matches", label: "Matches" },
  { to: "/tracker", label: "Tracker" },
  { to: "/companies", label: "Companies" },
  { to: "/salary", label: "Salary" },
  { to: "/skills", label: "Skills" },
  { to: "/settings", label: "Settings" },
];

export function AppShell() {
  const { signOut } = useAuth();

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 border-b border-rule bg-paper/90 backdrop-blur-sm">
        <div className="mx-auto flex h-[62px] max-w-[1180px] items-center gap-6 px-6">
          <span className="mr-auto font-display text-lg font-bold tracking-tight">
            job<span className="text-live">spy</span>
          </span>
          <nav className="hidden items-center gap-6 sm:flex">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
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
        <Outlet />
      </main>
    </div>
  );
}
