import { Link } from "react-router-dom";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  timeAgo,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  type Notification,
} from "@/hooks/useNotifications";

/**
 * Full notification history (roadmap M22, Layer 1) — the compact
 * dropdown in NotificationBell.tsx only shows a handful; this page
 * is everything useNotifications() returns (capped at 50 server-side,
 * newest first). There is no email/push delivery yet — see
 * supabase/functions/send-notification's header comment for Layer 2,
 * which stays inert until a Resend key exists.
 */
export function NotificationsPage() {
  const { data: notifications, isPending, isError, refetch } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unreadCount = (notifications ?? []).filter((n) => !n.read_at).length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-70">
            A background task failing, or a job you're tracking suddenly looking higher-risk —
            surfaced here so it's not missed if you've navigated away. There's no email or push
            delivery yet, so this page (and the bell above it) is the only place these show up.
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="ghost" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
            Mark all read
          </Button>
        )}
      </div>

      {isPending && (
        <div className="space-y-3" aria-hidden="true">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isPending && !isError && notifications && notifications.length === 0 && (
        <EmptyState
          title="Nothing yet"
          body="You'll see something here the first time a background task fails, or a job you're tracking gets flagged as higher ghost-risk."
        />
      )}

      {!isPending && !isError && notifications && notifications.length > 0 && (
        <div className="space-y-2">
          {notifications.map((n) => (
            <NotificationRow key={n.id} notification={n} onMarkRead={() => markRead.mutate(n.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  notification,
  onMarkRead,
}: {
  notification: Notification;
  onMarkRead: () => void;
}) {
  const unread = !notification.read_at;

  const body = (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-live" aria-hidden="true" />}
          <span className={unread ? "font-semibold text-ink" : "font-medium text-ink-70"}>
            {notification.title}
          </span>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-ink-70">{notification.body}</p>
        <p className="mt-1.5 text-xs text-ink-45">{timeAgo(notification.created_at)}</p>
      </div>

      {unread && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMarkRead();
          }}
          className="shrink-0 text-xs text-ink-70 transition-colors hover:text-ink"
        >
          Mark read
        </button>
      )}
    </div>
  );

  if (notification.link) {
    return (
      <Link to={notification.link} onClick={unread ? onMarkRead : undefined} className="block">
        <Card className="transition-colors hover:border-ink">{body}</Card>
      </Link>
    );
  }

  return <Card>{body}</Card>;
}
