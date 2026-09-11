import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

/**
 * In-app notifications (roadmap M22, Layer 1). Two server-side
 * triggers (0019_notifications.sql) write rows here — a background
 * task failing, or a tracked job's ghost-risk escalating to high.
 * There is no push/email delivery live yet (that's Layer 2,
 * supabase/functions/send-notification, inert until a Resend key
 * exists) — this hook is purely "read what the database already
 * wrote," same as every other client-only feature in this app.
 *
 * `notifications` isn't in the hand-written Database type in
 * src/types/database.ts (deliberately not touched — see
 * useJobAlerts.ts / useCompanyIntelligence.ts for the established
 * precedent of containing an untyped table to one cast at the query
 * boundary instead of teaching the whole client about it).
 */

export type NotificationType = "task_failed" | "ghost_risk_escalated";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

const RECENT_LIMIT = 50;

/**
 * Coarse relative time for a notification's `created_at` — finer
 * grained than src/lib/format.ts's `relativeDays` (built for
 * day-granular application dates), since "queued 40 seconds ago" and
 * "3 days ago" both need to read naturally in a notification list.
 * Falls back to a plain locale date once something is old enough
 * that a relative phrase stops being useful.
 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = now - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "just now";
  if (diffMs < hour) {
    const m = Math.floor(diffMs / minute);
    return `${m}m ago`;
  }
  if (diffMs < day) {
    const h = Math.floor(diffMs / hour);
    return `${h}h ago`;
  }
  if (diffMs < 7 * day) {
    const d = Math.floor(diffMs / day);
    return `${d}d ago`;
  }
  return new Date(iso).toLocaleDateString();
}

// One untyped cast here, honest interfaces at every call site — same
// containment strategy as jobAlertsTable() in useJobAlerts.ts.
const notificationsTable = () => supabase.from("notifications" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export function notificationsKey(userId: string | undefined) {
  return ["notifications", userId] as const;
}

export function unreadNotificationCountKey(userId: string | undefined) {
  return ["notifications-unread-count", userId] as const;
}

/** The current user's most recent notifications, newest first. */
export function useNotifications() {
  const { user } = useAuth();
  const key = notificationsKey(user?.id);

  useRealtimeNotifications(user?.id, key);

  return useQuery({
    queryKey: key,
    enabled: !!user,
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await notificationsTable()
        .select("id, type, title, body, link, read_at, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(RECENT_LIMIT);

      if (error) throw error;
      return (data ?? []) as unknown as Notification[];
    },
  });
}

/**
 * A separate count-only query, so the bell's badge number doesn't
 * require pulling the full recent-notifications payload just to
 * render a digit.
 */
export function useUnreadNotificationCount() {
  const { user } = useAuth();
  const key = unreadNotificationCountKey(user?.id);

  useRealtimeNotifications(user?.id, key);

  return useQuery({
    queryKey: key,
    enabled: !!user,
    queryFn: async (): Promise<number> => {
      const { count, error } = await notificationsTable()
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .is("read_at", null);

      if (error) throw error;
      return count ?? 0;
    },
  });
}

/**
 * Subscribes to Realtime INSERT events on `notifications` for the
 * current user and invalidates the given query key when one arrives —
 * mirrors useCreditBalance.ts's realtime-subscribe-then-invalidate
 * pattern. Called once per consuming hook so both the list and the
 * count badge update live without a manual refetch.
 */
function useRealtimeNotifications(userId: string | undefined, key: readonly unknown[]) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${key.join(":")}-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => queryClient.invalidateQueries({ queryKey: key })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, queryClient]);
}

/** Marks one notification read, optimistic with rollback on failure. */
export function useMarkNotificationRead() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const listKey = notificationsKey(user?.id);
  const countKey = unreadNotificationCountKey(user?.id);

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await notificationsTable()
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<Notification[]>(listKey);
      queryClient.setQueryData<Notification[]>(listKey, (old) =>
        (old ?? []).map((n) => (n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n))
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(listKey, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      queryClient.invalidateQueries({ queryKey: countKey });
    },
  });
}

/** Marks every unread notification for this user read in one write. */
export function useMarkAllNotificationsRead() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const listKey = notificationsKey(user?.id);
  const countKey = unreadNotificationCountKey(user?.id);

  return useMutation({
    mutationFn: async () => {
      const { error } = await notificationsTable()
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", user!.id)
        .is("read_at", null);
      if (error) throw error;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<Notification[]>(listKey);
      const now = new Date().toISOString();
      queryClient.setQueryData<Notification[]>(listKey, (old) =>
        (old ?? []).map((n) => (n.read_at ? n : { ...n, read_at: now }))
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(listKey, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      queryClient.invalidateQueries({ queryKey: countKey });
    },
  });
}
