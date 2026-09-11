import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export interface AssistedApplyAnswer {
  question: string;
  answer: string;
  insufficient_info: boolean;
  note: string | null;
}

/** What the Edge Function writes to the task row's `result`. */
export interface AssistedApplyResult extends Record<string, unknown> {
  job_id: string;
  answers: AssistedApplyAnswer[];
  model: string;
}

export function assistedApplyKey(userId: string | undefined, jobId: string) {
  return ["assisted-apply", userId, jobId] as const;
}

/**
 * No dedicated table — like resume_optimize and skill_gap, the
 * result lives on the task row. This reads the most recently
 * completed assisted_apply task whose input names this job.
 */
export function useLatestAssistedApply(jobId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: assistedApplyKey(user?.id, jobId ?? "none"),
    enabled: !!user && !!jobId,
    queryFn: async (): Promise<AssistedApplyResult | null> => {
      const { data, error } = await supabase
        .from("tasks")
        .select("result, updated_at")
        .eq("user_id", user!.id)
        .eq("task_type", "assisted_apply")
        .eq("status", "done")
        .order("updated_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      const match = (data ?? []).find(
        (t) => (t.result as AssistedApplyResult | null)?.job_id === jobId
      );
      return (match?.result as AssistedApplyResult | undefined) ?? null;
    },
  });
}

/** Same shape as useInFlightResumeCheckTask — pick a running draft
 *  back up rather than offering a button that spends a second credit
 *  on one already in flight for this job. */
export function useInFlightAssistedApplyTask(jobId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["assisted-apply-task", user?.id, jobId ?? "none"],
    enabled: !!user && !!jobId,
    staleTime: 0,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, status, input, created_at")
        .eq("user_id", user!.id)
        .eq("task_type", "assisted_apply")
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      const match = (data ?? []).find(
        (t) => (t.input as { job_id?: string } | null)?.job_id === jobId
      );
      return match?.id ?? null;
    },
  });
}

export function useInvalidateAssistedApply(jobId: string | null) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return () => {
    qc.invalidateQueries({ queryKey: assistedApplyKey(user?.id, jobId ?? "none") });
    qc.invalidateQueries({ queryKey: ["assisted-apply-task", user?.id, jobId ?? "none"] });
  };
}
