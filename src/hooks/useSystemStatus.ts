import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Minor m40: a real status row, publicly readable (no auth needed —
 * a status page that requires sign-in to view defeats the point),
 * admin-writable. `system_status` isn't in the hand-written Database
 * type — same containment precedent as `saved_searches`.
 */
const statusTable = () => supabase.from("system_status" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export type SystemStatusLevel = "operational" | "degraded" | "outage";

export interface SystemStatus {
  status: SystemStatusLevel;
  message: string | null;
  updated_at: string;
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ["system-status"],
    staleTime: 30_000,
    queryFn: async (): Promise<SystemStatus> => {
      const { data, error } = await statusTable().select("status, message, updated_at").single();
      if (error) throw error;
      return data as unknown as SystemStatus;
    },
  });
}

/** Admin-only in practice — RLS rejects anyone else's write, see migration 0030. */
export function useUpdateSystemStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { status: SystemStatusLevel; message: string | null }) => {
      const { error } = await statusTable().update({ ...patch, updated_at: new Date().toISOString() }).eq("id", true);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["system-status"] }),
  });
}
