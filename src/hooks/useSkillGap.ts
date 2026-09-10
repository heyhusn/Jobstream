import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export interface SkillGapItem {
  skill: string;
  mentioned_in: number;
  why_it_matters: string;
  resource: string;
}

/** What the Edge Function writes to the task row's `result`. */
export interface SkillGapTaskResult extends Record<string, unknown> {
  gaps: SkillGapItem[];
  strengths: string[];
  narrative: string;
  jobs_considered: number;
  model: string;
}

export function skillGapKey(userId: string | undefined) {
  return ["skill-gap", userId] as const;
}

/**
 * There's no dedicated table for this one — like parse_resume, the
 * result lives on the task row itself. This reads the most recently
 * completed skill_gap task so the analysis survives a reload instead
 * of vanishing the moment the async task's in-memory state resets.
 */
export function useLatestSkillGap() {
  const { user } = useAuth();

  return useQuery({
    queryKey: skillGapKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<{ result: SkillGapTaskResult; computedAt: string } | null> => {
      const { data, error } = await supabase
        .from("tasks")
        .select("result, updated_at")
        .eq("user_id", user!.id)
        .eq("task_type", "skill_gap")
        .eq("status", "done")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data?.result) return null;
      return { result: data.result as SkillGapTaskResult, computedAt: data.updated_at };
    },
  });
}

export function useInvalidateSkillGap() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return () => qc.invalidateQueries({ queryKey: skillGapKey(user?.id) });
}
