import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export interface MatchedRequirement {
  requirement: string;
  evidence: string;
}
export interface ResumeGap {
  requirement: string;
  why_it_matters: string;
  suggestion: string;
}

/** What the Edge Function writes to the task row's `result`. */
export interface ResumeOptimizerResult extends Record<string, unknown> {
  job_id: string;
  matched: MatchedRequirement[];
  gaps: ResumeGap[];
  knockouts: string[];
  model: string;
}

export function resumeOptimizerKey(userId: string | undefined, jobId: string) {
  return ["resume-optimizer", userId, jobId] as const;
}

/**
 * No dedicated table — like skill_gap and parse_resume, the result
 * lives on the task row. This reads the most recently completed
 * resume_optimize task whose input names this job.
 */
export function useLatestResumeCheck(jobId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: resumeOptimizerKey(user?.id, jobId ?? "none"),
    enabled: !!user && !!jobId,
    queryFn: async (): Promise<ResumeOptimizerResult | null> => {
      const { data, error } = await supabase
        .from("tasks")
        .select("result, updated_at")
        .eq("user_id", user!.id)
        .eq("task_type", "resume_optimize")
        .eq("status", "done")
        .order("updated_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      const match = (data ?? []).find(
        (t) => (t.result as ResumeOptimizerResult | null)?.job_id === jobId
      );
      return (match?.result as ResumeOptimizerResult | undefined) ?? null;
    },
  });
}

/** Same shape as useInFlightCoverLetterTask — pick a running check
 *  back up rather than offering a button that spends a second credit
 *  on one already in flight for this job. */
export function useInFlightResumeCheckTask(jobId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["resume-optimizer-task", user?.id, jobId ?? "none"],
    enabled: !!user && !!jobId,
    staleTime: 0,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, status, input, created_at")
        .eq("user_id", user!.id)
        .eq("task_type", "resume_optimize")
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

export function useInvalidateResumeCheck(jobId: string | null) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return () => {
    qc.invalidateQueries({ queryKey: resumeOptimizerKey(user?.id, jobId ?? "none") });
    qc.invalidateQueries({ queryKey: ["resume-optimizer-task", user?.id, jobId ?? "none"] });
  };
}
