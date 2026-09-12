import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { Seniority } from "@/types/database";

/**
 * Minor m13's "user override" half — the classifier itself
 * (`public.extract_job_signals`, migration 0025) writes a shared
 * `jobs.seniority` every user sees the same value for, so disagreeing
 * with it can't mean editing that row. This is a per-user override
 * table instead, read preferentially wherever seniority is displayed.
 */
const overridesTable = () => supabase.from("seniority_overrides" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export function seniorityOverridesKey(userId: string | undefined) {
  return ["seniority-overrides", userId] as const;
}

/** All of the current user's overrides, as a Map for cheap lookup per job row. */
export function useSeniorityOverrides() {
  const { user } = useAuth();
  return useQuery({
    queryKey: seniorityOverridesKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<Map<string, Seniority>> => {
      const { data, error } = await overridesTable()
        .select("job_id, seniority")
        .eq("user_id", user!.id);
      if (error) throw error;
      return new Map(
        (data ?? []).map((r: any) => [r.job_id as string, r.seniority as Seniority]) // eslint-disable-line @typescript-eslint/no-explicit-any
      );
    },
  });
}

export function useSetSeniorityOverride() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = seniorityOverridesKey(user?.id);

  return useMutation({
    mutationFn: async ({ jobId, seniority }: { jobId: string; seniority: Seniority }) => {
      const { error } = await overridesTable().upsert(
        { user_id: user!.id, job_id: jobId, seniority },
        { onConflict: "user_id,job_id" }
      );
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
