import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { RiskBand, Seniority, VisaSponsorship } from "@/types/database";

export type MatchedVia = "keyword" | "semantic" | "both";

export interface HybridSearchResult {
  job: {
    id: string;
    title: string;
    description: string;
    location: string | null;
    remote_type: string | null;
    salary_min: number | null;
    salary_max: number | null;
    salary_currency: string;
    apply_url: string;
    posted_at: string | null;
    first_seen_at: string;
    repost_count: number;
    visa_sponsorship: VisaSponsorship | null;
    seniority: Seniority | null;
    tech_stack: string[];
    company: { id: string; canonical_name: string; domain: string | null } | null;
  };
  risk_band: RiskBand | null;
  rrf_score: number;
  matched_via: MatchedVia;
}

/**
 * M03 from the roadmap: searches every active posting (not just a
 * user's precomputed matches — that's what the Matches page's
 * client-side filter already does), fusing full-text and semantic
 * retrieval server-side via the `hybrid-search` Edge Function and
 * `search_jobs_hybrid` (migration 0023_hybrid_search.sql).
 */
export function useHybridSearch() {
  return useMutation({
    mutationFn: async (query: string): Promise<HybridSearchResult[]> => {
      const { data, error } = await supabase.functions.invoke("hybrid-search", {
        body: { query },
      });
      if (error) throw error;
      return (data?.results as HybridSearchResult[]) ?? [];
    },
  });
}
