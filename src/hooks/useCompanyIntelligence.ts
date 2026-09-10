import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { RemoteType, RiskBand } from "@/types/database";

/**
 * Row shape of `public.company_intelligence` (migration
 * 0011_company_intelligence.sql) — a plain aggregation view over
 * `companies` + `jobs` + `ghost_signals`, not a table the hand-written
 * `Database` type in `src/types/database.ts` knows about. Same
 * containment strategy as `useMatches`/`useApplications`: one honest
 * interface here, one cast at the query boundary, rather than teaching
 * the whole app's type layer about a view it only reads.
 *
 * This is market data, not user data — like jobs/companies/ghost_signals
 * themselves, it's public-read (see 0001_init.sql's policies and 0011's
 * grant), so these hooks don't gate on `useAuth` the way per-user hooks
 * like `useMatches` do.
 */
export interface CompanyIntelligence {
  company_id: string;
  canonical_name: string;
  domain: string | null;
  ats_type: string | null;
  size_band: string | null;
  hq_country: string | null;
  open_roles_count: number;
  total_roles_seen: number;
  avg_days_open: number | null;
  repost_rate: number | null;
  ghost_low_count: number;
  ghost_medium_count: number;
  ghost_high_count: number;
  last_ingested_at: string | null;
}

const COMPANY_INTELLIGENCE_SELECT =
  "company_id, canonical_name, domain, ats_type, size_band, hq_country, " +
  "open_roles_count, total_roles_seen, avg_days_open, repost_rate, " +
  "ghost_low_count, ghost_medium_count, ghost_high_count, last_ingested_at";

// The hand-written Database type's `Views` is deliberately
// `Record<string, never>` (see the header comment in
// src/types/database.ts) so `.from()`'s overloads don't know this view
// exists. Rather than teach the whole client about a view only these
// two hooks read, the untyped-ness is contained to this one cast —
// same containment strategy the file already uses for the nested
// ghost_signals join below.
const companyIntelligenceTable = () => supabase.from("company_intelligence" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export function companyIntelligenceKey(companyId: string | undefined) {
  return ["company-intelligence", companyId] as const;
}

/** One company's rollup, for the detail page. */
export function useCompanyIntelligence(companyId: string | undefined) {
  return useQuery({
    queryKey: companyIntelligenceKey(companyId),
    enabled: !!companyId,
    queryFn: async (): Promise<CompanyIntelligence | null> => {
      const { data, error } = await companyIntelligenceTable()
        .select(COMPANY_INTELLIGENCE_SELECT)
        .eq("company_id", companyId!)
        .maybeSingle();

      if (error) throw error;
      return (data as unknown as CompanyIntelligence) ?? null;
    },
  });
}

/** Every company that has at least one ingested job, most open roles first. */
export function useCompanyList() {
  return useQuery({
    queryKey: ["company-intelligence-list"],
    queryFn: async (): Promise<CompanyIntelligence[]> => {
      const { data, error } = await companyIntelligenceTable()
        .select(COMPANY_INTELLIGENCE_SELECT)
        .order("open_roles_count", { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as CompanyIntelligence[];
    },
  });
}

export interface CompanyOpenRole {
  id: string;
  title: string;
  apply_url: string;
  location: string | null;
  remote_type: RemoteType | null;
  risk_band: RiskBand | null;
}

// jobs -> ghost_signals has no declared FK Relationship in the
// hand-written Database type (same gap useMatches works around), so
// the nested select comes back untyped and gets one honest cast here.
interface RawOpenRoleRow {
  id: string;
  title: string;
  apply_url: string;
  location: string | null;
  remote_type: RemoteType | null;
  ghost_signals: { risk_band: RiskBand }[] | null;
}

/** This company's currently open roles, for the detail page's role list. */
export function useCompanyOpenRoles(companyId: string | undefined) {
  return useQuery({
    queryKey: ["company-open-roles", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<CompanyOpenRole[]> => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          `id, title, apply_url, location, remote_type,
           ghost_signals ( risk_band )`
        )
        .eq("company_id", companyId!)
        .eq("is_active", true)
        .order("first_seen_at", { ascending: false });

      if (error) throw error;

      return ((data ?? []) as unknown as RawOpenRoleRow[]).map((row) => ({
        id: row.id,
        title: row.title,
        apply_url: row.apply_url,
        location: row.location,
        remote_type: row.remote_type,
        risk_band: row.ghost_signals?.[0]?.risk_band ?? null,
      }));
    },
  });
}
