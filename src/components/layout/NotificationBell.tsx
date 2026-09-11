import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  timeAgo,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
  type Notification,
} from "@/hooks/useNotifications";

/**
 * Bell + dropdown for the header (roadmap M22, Layer 1). Not mounted
 * anywhere by this file on purpose — the orchestrating session wires
 * it into AppShell.tsx alongside CreditChip, specifically so this
 * feature and unrelated concurrent work never collide on that shared
 * file.
 *
 * No icon library exists in this repo (see package.json) — the bell
 * is a plain inline SVG, not a new dependency.
 */

const DROPDOWN_LIMIT = 8;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data: notifications, isPending } = useNotifications();
  const { data: unreadCount } = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  function handleSelect(n: Notification) {
    if (!n.read_at) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  const recent = (notifications ?? []).slice(0, DROPDOWN_LIMIT);
  const count = unreadCount ?? 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-8 w-8 items-center justify-center rounded-app text-ink-70 transition-colors hover:text-ink"
        aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
        aria-expanded={open}
      >
        <BellIcon />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-ghost px-1 text-[10px] font-semibold leading-none text-paper">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-80 rounded-app border border-rule bg-raised shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-rule px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {count > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="text-xs text-ink-70 transition-colors hover:text-ink disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isPending && <p className="px-3 py-6 text-center text-sm text-ink-45">Loading…</p>}

            {!isPending && recent.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-ink-45">Nothing yet.</p>
            )}

            {recent.map((n) => (
              <button
                key={n.id}
                role="menuitem"
                onClick={() => handleSelect(n)}
                className={
                  "block w-full border-b border-rule/60 px-3 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-rule-soft/50 " +
                  (n.read_at ? "" : "bg-live-wash/40")
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={n.read_at ? "font-medium text-ink-70" : "font-semibold text-ink"}>
                    {n.title}
                  </span>
                  {!n.read_at && (
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-live" aria-hidden="true" />
                  )}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-70">{n.body}</p>
                <p className="mt-1 text-[11px] text-ink-45">{timeAgo(n.created_at)}</p>
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              setOpen(false);
              navigate("/notifications");
            }}
            className="block w-full border-t border-rule px-3 py-2 text-center text-xs font-medium text-ink-70 transition-colors hover:text-ink"
          >
            View all
          </button>
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
