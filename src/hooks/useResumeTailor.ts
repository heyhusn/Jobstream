import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export interface ResumeRewrite {
  original: string;
  tailored: string;
  rationale: string;
}

/** What the Edge Function writes to the task row's `result`. */
export interface ResumeTailorResult extends Record<string, unknown> {
  job_id: string;
  rewrites: ResumeRewrite[];
  not_addressed: string[];
  model: string;
}

export function resumeTailorKey(userId: string | undefined, jobId: string) {
  return ["resume-tailor", userId, jobId] as const;
}

/**
 * No dedicated table — like resume_optimize and skill_gap, the
 * result lives on the task row. This reads the most recently
 * completed tailor_resume task whose input names this job.
 */
export function useLatestResumeTailor(jobId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: resumeTailorKey(user?.id, jobId ?? "none"),
    enabled: !!user && !!jobId,
    queryFn: async (): Promise<ResumeTailorResult | null> => {
      const { data, error } = await supabase
        .from("tasks")
        .select("result, updated_at")
        .eq("user_id", user!.id)
        .eq("task_type", "tailor_resume")
        .eq("status", "done")
        .order("updated_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      const match = (data ?? []).find(
        (t) => (t.result as ResumeTailorResult | null)?.job_id === jobId
      );
      return (match?.result as ResumeTailorResult | undefined) ?? null;
    },
  });
}

/** Same shape as useInFlightResumeCheckTask — pick a running tailor
 *  run back up rather than offering a button that spends a second
 *  credit on one already in flight for this job. */
export function useInFlightResumeTailorTask(jobId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["resume-tailor-task", user?.id, jobId ?? "none"],
    enabled: !!user && !!jobId,
    staleTime: 0,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, status, input, created_at")
        .eq("user_id", user!.id)
        .eq("task_type", "tailor_resume")
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

export function useInvalidateResumeTailor(jobId: string | null) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return () => {
    qc.invalidateQueries({ queryKey: resumeTailorKey(user?.id, jobId ?? "none") });
    qc.invalidateQueries({ queryKey: ["resume-tailor-task", user?.id, jobId ?? "none"] });
  };
}
