import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { RemoteType, RiskBand } from "@/types/database";

/**
 * Smart Job Alerts (M16), scoped honestly (see migration
 * 0014_job_alerts.sql's header comment): there's no scheduler and no
 * email/push infra anywhere in this codebase, so this is a pull-based
 * feature. An alert is just a named filter; "checking" it means
 * running that filter against currently-active jobs right now, on
 * page load or a "Check now" click — never in the background.
 *
 * `job_alerts` isn't in the hand-written Database type in
 * src/types/database.ts (deliberately not touched here — see
 * useCompanyIntelligence.ts for the established precedent of
 * containing an untyped table/view to one cast at the query
 * boundary instead of teaching the whole client about it).
 */

export interface AlertFilter {
  remote_type: RemoteType | null;
  min_salary: number | null;
  keywords: string[];
  max_ghost_risk: RiskBand | null;
}

export function emptyAlertFilter(): AlertFilter {
  return { remote_type: null, min_salary: null, keywords: [], max_ghost_risk: null };
}

export interface JobAlert {
  id: string;
  user_id: string;
  name: string;
  filter: AlertFilter;
  last_checked_at: string;
  created_at: string;
}

export interface AlertJob {
  id: string;
  title: string;
  location: string | null;
  remote_type: RemoteType | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  apply_url: string;
  first_seen_at: string;
  company: { canonical_name: string } | null;
  risk_band: RiskBand | null;
}

const RISK_ORDER: Record<RiskBand, number> = { low: 0, medium: 1, high: 2 };

/**
 * Same filtering logic as useNaturalLanguageSearch.ts's
 * `matchesFilter` (remote_type exact match, min_salary compares
 * against the salary ceiling, max_ghost_risk is an ordered
 * comparison, keywords is a case-insensitive substring match) —
 * deliberately reimplemented locally rather than imported, so this
 * feature has zero coupling with that in-flight one.
 */
export function matchesAlertFilter(job: AlertJob, filter: AlertFilter): boolean {
  if (filter.remote_type && job.remote_type !== filter.remote_type) return false;

  if (filter.min_salary != null) {
    const ceiling = job.salary_max ?? job.salary_min;
    if (ceiling == null || ceiling < filter.min_salary) return false;
  }

  if (filter.max_ghost_risk && job.risk_band) {
    if (RISK_ORDER[job.risk_band] > RISK_ORDER[filter.max_ghost_risk]) return false;
  }

  if (filter.keywords.length > 0) {
    const haystack = [job.title, job.location, job.company?.canonical_name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const hit = filter.keywords.some((k) => haystack.includes(k.toLowerCase()));
    if (!hit) return false;
  }

  return true;
}

// The hand-written Database type's `Tables` doesn't know about
// `job_alerts` (src/types/database.ts is deliberately not touched by
// this feature — another table edit is in flight elsewhere). Same
// containment strategy as useCompanyIntelligence.ts's
// `companyIntelligenceTable()`: one untyped cast here, one honest
// interface at every call site.
const jobAlertsTable = () => supabase.from("job_alerts" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

interface RawJobAlertRow {
  id: string;
  user_id: string;
  name: string;
  filter: AlertFilter | null;
  last_checked_at: string;
  created_at: string;
}

function normalizeAlert(row: RawJobAlertRow): JobAlert {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    filter: { ...emptyAlertFilter(), ...(row.filter ?? {}) },
    last_checked_at: row.last_checked_at,
    created_at: row.created_at,
  };
}

export function jobAlertsKey(userId: string | undefined) {
  return ["job-alerts", userId] as const;
}

/** The current user's saved alert rules, newest first. */
export function useJobAlerts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: jobAlertsKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<JobAlert[]> => {
      const { data, error } = await jobAlertsTable()
        .select("id, user_id, name, filter, last_checked_at, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return ((data ?? []) as unknown as RawJobAlertRow[]).map(normalizeAlert);
    },
  });
}

export function useCreateJobAlert() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = jobAlertsKey(user?.id);

  return useMutation({
    mutationFn: async ({ name, filter }: { name: string; filter: AlertFilter }) => {
      const { error } = await jobAlertsTable().insert({
        user_id: user!.id,
        name,
        filter,
      });
      if (error) throw error;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}

/** Renames an alert and/or replaces its filter — a simple partial patch, no optimistic UI needed for this feature. */
export function useUpdateJobAlert() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = jobAlertsKey(user?.id);

  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<JobAlert, "name" | "filter">>;
    }) => {
      const { error } = await jobAlertsTable().update(patch).eq("id", id).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useDeleteJobAlert() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = jobAlertsKey(user?.id);

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await jobAlertsTable().delete().eq("id", id).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * Stamps `last_checked_at` to now — called after "Check now" (or an
 * initial page-load check) so the next visit can tell "new since you
 * last looked" apart from everything that already matched.
 */
export function useMarkAlertChecked() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = jobAlertsKey(user?.id);

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await jobAlertsTable()
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}

// jobs -> ghost_signals has no declared FK Relationship in the
// hand-written Database type (same gap useCompanyIntelligence.ts's
// useCompanyOpenRoles works around), so the nested select comes back
// untyped and gets one honest cast here.
interface RawAlertMatchRow {
  id: string;
  title: string;
  location: string | null;
  remote_type: RemoteType | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  apply_url: string;
  first_seen_at: string;
  company: { canonical_name: string } | null;
  ghost_signals: { risk_band: RiskBand }[] | null;
}

/**
 * Pulls currently-active jobs and applies `matchesAlertFilter` in JS.
 * There's no server-side filter function for this (no stored
 * procedure takes an arbitrary AlertFilter jsonb blob), so — same
 * honest tradeoff as parse-search-query's client-side filtering — a
 * bounded, recent slice is fetched and filtered here rather than
 * built as a real search query. Capped at 200 most-recently-seen
 * active jobs to keep that client-side pass cheap; a much larger
 * active-jobs table would need a real query instead.
 *
 * Not tied to a specific alert row — callers pass whatever filter
 * they want evaluated (a saved alert's filter, or a draft being
 * edited), and the query key includes a stable stringification of it
 * so different filters cache separately.
 */
export function useAlertMatches(filter: AlertFilter) {
  const filterKey = JSON.stringify({
    remote_type: filter.remote_type,
    min_salary: filter.min_salary,
    keywords: [...filter.keywords].sort(),
    max_ghost_risk: filter.max_ghost_risk,
  });

  return useQuery({
    queryKey: ["alert-matches", filterKey],
    queryFn: async (): Promise<AlertJob[]> => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          `id, title, location, remote_type, salary_min, salary_max, salary_currency,
           apply_url, first_seen_at,
           company:companies ( canonical_name ),
           ghost_signals ( risk_band )`
        )
        .eq("is_active", true)
        .order("first_seen_at", { ascending: false })
        .limit(200);

      if (error) throw error;

      const jobs: AlertJob[] = ((data ?? []) as unknown as RawAlertMatchRow[]).map((row) => ({
        id: row.id,
        title: row.title,
        location: row.location,
        remote_type: row.remote_type,
        salary_min: row.salary_min,
        salary_max: row.salary_max,
        salary_currency: row.salary_currency,
        apply_url: row.apply_url,
        first_seen_at: row.first_seen_at,
        company: row.company ?? null,
        risk_band: row.ghost_signals?.[0]?.risk_band ?? null,
      }));

      return jobs.filter((job) => matchesAlertFilter(job, filter));
    },
  });
}
