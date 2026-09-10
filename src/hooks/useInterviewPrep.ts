import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { InterviewMode, InterviewSessionStatus, InterviewSummary, InterviewTurn } from "@/types/database";

export interface InterviewSession {
  id: string;
  mode: InterviewMode;
  status: InterviewSessionStatus;
  turns: InterviewTurn[];
  turn_count: number;
  max_turns: number;
  summary: InterviewSummary | null;
  job_id: string;
  job: { title: string; company: { canonical_name: string } | null } | null;
}

/** What interview-prep writes to the task row's `result`, for both
 *  the 'start' and 'answer' actions. */
export interface InterviewTaskResult extends Record<string, unknown> {
  session_id: string;
  mode: InterviewMode;
  status: InterviewSessionStatus;
  turns: InterviewTurn[];
  turn_count: number;
  max_turns: number;
  summary: InterviewSummary | null;
  job_title?: string;
  company_name?: string | null;
}

export function interviewSessionKey(sessionId: string | undefined) {
  return ["interview-session", sessionId] as const;
}

/**
 * Reads a session directly (not through a task result) so reloading
 * the interview page — or coming back to it later — shows the real
 * persisted state rather than nothing. Every turn's task result is
 * already this same shape, so the page can render from either
 * source interchangeably.
 */
export function useInterviewSession(sessionId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: interviewSessionKey(sessionId),
    enabled: !!user && !!sessionId,
    queryFn: async (): Promise<InterviewSession | null> => {
      const { data, error } = await supabase
        .from("interview_sessions")
        .select(
          "id, mode, status, turns, turn_count, max_turns, summary, job_id, job:jobs ( title, company:companies ( canonical_name ) )"
        )
        .eq("id", sessionId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as InterviewSession | null;
    },
  });
}

export function useInvalidateInterviewSession(sessionId: string | undefined) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: interviewSessionKey(sessionId) });
}
