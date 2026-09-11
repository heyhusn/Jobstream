import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

/**
 * Admin Console (M24). Every function this file calls is `security
 * definer` and checks `is_admin()` as its own first statement (see
 * migration 0020_admin_console.sql) — that is the real security
 * boundary. `useIsAdmin()` gates the UI for convenience only; a
 * non-admin who somehow reached the page would still get an
 * exception back from every one of these RPCs, not data.
 */

export function useIsAdmin() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("is_admin");
      if (error) throw error;
      return data === true;
    },
  });
}

export interface AdminOverview {
  total_users: number;
  total_active_jobs: number;
  total_applications: number;
  unread_notifications: number;
  cost_today_usd: number;
  credits_charged_today: number;
  daily_cost_cap_usd: number | null;
}

export function useAdminOverview(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-overview"],
    enabled,
    refetchInterval: 30_000,
    queryFn: async (): Promise<AdminOverview> => {
      const { data, error } = await supabase.rpc("admin_overview");
      if (error) throw error;
      return data as AdminOverview;
    },
  });
}

export interface TaskHealthRow {
  task_type: string;
  status: string;
  count: number;
}

export function useAdminTaskHealth(enabled: boolean, hours = 24) {
  return useQuery({
    queryKey: ["admin-task-health", hours],
    enabled,
    queryFn: async (): Promise<TaskHealthRow[]> => {
      // The hand-written Database type's `Functions` is
      // `Record<string, never>` (see src/types/database.ts's header
      // comment), so `.rpc()` only knows how to call functions with
      // no arguments — every other RPC in this codebase is zero-arg.
      // Same containment strategy as the untyped-table casts
      // elsewhere: one `as any` here, an honest return type right
      // after.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("admin_task_health", { p_hours: hours });
      if (error) throw error;
      return (data ?? []) as TaskHealthRow[];
    },
  });
}

export interface SourceHealthRow {
  company_id: string;
  canonical_name: string;
  total_jobs: number;
  active_jobs: number;
  last_ingested_at: string | null;
}

export type AdminActionName = "ingest_jobs" | "recompute_ghost_signals" | "send_notification_digest";

/**
 * Runs a real, privileged action (manual ingestion, ghost-signal
 * recompute, or an email-digest send) via the `admin-action` Edge
 * Function. That function holds `TASK_DISPATCH_SECRET` server-side —
 * it never reaches the browser — and re-checks `is_admin()` itself
 * against the caller's own verified identity, so this hook being
 * reachable in the client bundle grants nothing on its own.
 */
export function useAdminAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: AdminActionName) => {
      const { data, error } = await supabase.functions.invoke("admin-action", {
        body: { action },
      });
      if (error) {
        const context = (error as { context?: Response }).context;
        let detail: string | null = null;
        if (context) {
          try {
            const body = await context.json();
            if (typeof body?.error === "string") detail = body.error;
          } catch {
            // context wasn't JSON — fall through to the generic error
          }
        }
        throw detail ? new Error(detail) : error;
      }
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
      queryClient.invalidateQueries({ queryKey: ["admin-source-health"] });
      queryClient.invalidateQueries({ queryKey: ["admin-task-health", 24] });
    },
  });
}

export function useAdminSourceHealth(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-source-health"],
    enabled,
    queryFn: async (): Promise<SourceHealthRow[]> => {
      const { data, error } = await supabase.rpc("admin_source_health");
      if (error) throw error;
      return (data ?? []) as SourceHealthRow[];
    },
  });
}
