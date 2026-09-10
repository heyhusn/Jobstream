import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { RemoteType, RiskBand } from "@/types/database";

export interface SearchFilter {
  remote_type: RemoteType | null;
  min_salary: number | null;
  keywords: string[];
  max_ghost_risk: RiskBand | null;
  confidence: number;
  unsupported: string | null;
}

/**
 * Calls parse-search-query directly (supabase.functions.invoke, not
 * the tasks-table pattern the credit-charging AI features use) — this
 * has nothing to charge for and nothing to persist, just a short
 * round trip that turns a sentence into a typed filter. The caller
 * applies that filter to whatever job list is already on screen.
 */
export function useNaturalLanguageSearch() {
  return useMutation({
    mutationFn: async (query: string): Promise<SearchFilter> => {
      const { data, error } = await supabase.functions.invoke("parse-search-query", {
        body: { query },
      });
      if (error) throw error;
      if (!data?.filter) throw new Error("No filter came back.");
      return data.filter as SearchFilter;
    },
  });
}

const RISK_ORDER: Record<RiskBand, number> = { low: 0, medium: 1, high: 2 };

/**
 * Confidence below this reads as "the model didn't really understand
 * the query" — worth telling the person, not silently guessing.
 */
export const LOW_CONFIDENCE = 0.35;

export function matchesFilter<
  T extends {
    job: {
      title: string;
      location: string | null;
      remote_type: string | null;
      salary_min: number | null;
      salary_max: number | null;
      company: { canonical_name: string } | null;
    };
    ghost: { risk_band: RiskBand } | null;
  },
>(item: T, filter: SearchFilter): boolean {
  if (filter.remote_type && item.job.remote_type !== filter.remote_type) return false;

  if (filter.min_salary != null) {
    const ceiling = item.job.salary_max ?? item.job.salary_min;
    if (ceiling == null || ceiling < filter.min_salary) return false;
  }

  if (filter.max_ghost_risk && item.ghost) {
    if (RISK_ORDER[item.ghost.risk_band] > RISK_ORDER[filter.max_ghost_risk]) return false;
  }

  if (filter.keywords.length > 0) {
    const haystack = [item.job.title, item.job.location, item.job.company?.canonical_name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const hit = filter.keywords.some((k) => haystack.includes(k.toLowerCase()));
    if (!hit) return false;
  }

  return true;
}
