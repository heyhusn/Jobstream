import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { ApplicationStage, InterviewMode } from "@/types/database";

/**
 * Market Analytics Dashboard (M21) — personal activity hooks only.
 * Every view queried here (migration 0018_user_analytics.sql) is
 * `security_invoker = true` over tables already RLS-scoped to
 * `auth.uid()`, so every hook below gates on `useAuth` the same way
 * `useApplications`/`useMatchScores` do (unlike the public market
 * views in `useCompanyIntelligence`/`useSalaryIntelligence`, which
 * don't need a signed-in user at all).
 *
 * Same containment strategy as those two files: the hand-written
 * `Database` type's `Views` is deliberately `Record<string, never>`
 * (see src/types/database.ts's header comment), so `.from()` doesn't
 * know these views exist. Rather than teach the whole client about
 * views only this file reads, the untyped-ness is contained to one
 * cast per view here, with an honest hand-written interface next to
 * each one.
 */

// ── Application funnel ─────────────────────────────────────────

export interface ApplicationFunnelRow {
  stage: ApplicationStage;
  count: number;
}

const funnelTable = () => supabase.from("my_application_funnel" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export function useApplicationFunnel() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["analytics-application-funnel", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<ApplicationFunnelRow[]> => {
      const { data, error } = await funnelTable().select("stage, count");
      if (error) throw error;
      return (data ?? []) as unknown as ApplicationFunnelRow[];
    },
  });
}

// ── Credit usage ────────────────────────────────────────────────

export interface CreditUsageRow {
  feature: string;
  credits_used: number;
  times_used: number;
  last_used_at: string;
}

const creditUsageTable = () => supabase.from("my_credit_usage" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export function useCreditUsage() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["analytics-credit-usage", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<CreditUsageRow[]> => {
      const { data, error } = await creditUsageTable()
        .select("feature, credits_used, times_used, last_used_at")
        .order("credits_used", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CreditUsageRow[];
    },
  });
}

// ── Ghost-risk exposure across tracked jobs ─────────────────────

/**
 * 'unknown' alongside the real risk bands: a tracked job whose
 * `ghost_signals` row hasn't been computed yet (or predates 0007)
 * is a real, distinct case — not the same as "low risk" — and the
 * view (0018) reports it honestly rather than dropping it.
 */
export type ExposureBand = "low" | "medium" | "high" | "unknown";

export interface GhostExposureRow {
  band: ExposureBand;
  count: number;
}

const ghostExposureTable = () => supabase.from("my_tracked_ghost_exposure" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export function useTrackedGhostExposure() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["analytics-ghost-exposure", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<GhostExposureRow[]> => {
      const { data, error } = await ghostExposureTable().select("band, count");
      if (error) throw error;
      return (data ?? []) as unknown as GhostExposureRow[];
    },
  });
}

// ── Match score trend ────────────────────────────────────────────

export interface MatchScoreTrendRow {
  day: string;
  avg_score: number;
  sample_size: number;
}

const matchScoreTrendTable = () => supabase.from("my_match_score_trend" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export function useMatchScoreTrend() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["analytics-match-score-trend", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<MatchScoreTrendRow[]> => {
      const { data, error } = await matchScoreTrendTable()
        .select("day, avg_score, sample_size")
        .order("day", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as MatchScoreTrendRow[];
    },
  });
}

// ── Interview prep progress ──────────────────────────────────────

export interface InterviewProgressRow {
  id: string;
  job_id: string;
  mode: InterviewMode;
  turn_count: number;
  completed_at: string;
  avg_score: number | null;
}

const interviewProgressTable = () => supabase.from("my_interview_progress" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Reads the `my_interview_progress` view (0018) rather than
 * `interview_sessions` directly — the view already narrows to
 * completed sessions and computes the per-session average score in
 * SQL, so the client isn't re-deriving that from `turns` on every
 * render.
 */
export function useInterviewProgress() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["analytics-interview-progress", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<InterviewProgressRow[]> => {
      const { data, error } = await interviewProgressTable()
        .select("id, job_id, mode, turn_count, completed_at, avg_score")
        .order("completed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as InterviewProgressRow[];
    },
  });
}
