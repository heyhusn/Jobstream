import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import {
  timeAgo,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
  type Notification,
} from "@/hooks/useNotifications";

/**
 * Bell + dropdown for the header (roadmap M22, Layer 1). Built on the
 * shared DropdownMenu primitive (Radix) rather than the hand-rolled
 * click-outside/Escape handling this component used before the redesign —
 * one audited focus/dismiss implementation instead of several.
 */

const DROPDOWN_LIMIT = 8;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const { data: notifications, isPending } = useNotifications();
  const { data: unreadCount } = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  function handleSelect(n: Notification) {
    if (!n.read_at) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  }

  const recent = (notifications ?? []).slice(0, DROPDOWN_LIMIT);
  const count = unreadCount ?? 0;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="relative flex h-8 w-8 items-center justify-center rounded-app text-ink-70 transition-colors hover:bg-rule-soft hover:text-ink"
          aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
        >
          <Bell size={17} />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-ghost px-1 text-[10px] font-semibold leading-none text-paper">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-80 p-0">
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
            <DropdownMenuItem
              key={n.id}
              onSelect={() => handleSelect(n)}
              className={
                "block w-full items-start rounded-none border-b border-rule/60 px-3 py-2.5 text-left last:border-b-0 " +
                (n.read_at ? "" : "bg-live-wash/40")
              }
            >
              <div className="w-full">
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
              </div>
            </DropdownMenuItem>
          ))}
        </div>

        <DropdownMenuItem
          onSelect={() => navigate("/notifications")}
          className="justify-center rounded-none border-t border-rule py-2 text-center text-xs font-medium text-ink-70"
        >
          View all
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
