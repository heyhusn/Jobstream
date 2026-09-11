import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { MatchSignal, RiskBand } from "@/types/database";

export interface MatchListItem {
  id: string;
  score: number;
  score_breakdown: MatchSignal[];
  job: {
    id: string;
    title: string;
    location: string | null;
    remote_type: string | null;
    salary_min: number | null;
    salary_max: number | null;
    salary_currency: string;
    apply_url: string;
    posted_at: string | null;
    company: { id: string; canonical_name: string } | null;
  };
  ghost: { risk_band: RiskBand; reasons: string[] } | null;
}

// The shape actually returned by the nested .select() below. The
// hand-written Database type doesn't declare foreign-key
// Relationships, so postgrest-js's select-string parser can't
// resolve these joins on its own — this interface is the honest
// substitute for that, and the single cast at the query boundary
// is where the untyped-ness of an unmodelled join is contained.
// `supabase gen types typescript` would make this cast unnecessary.
interface RawMatchRow {
  id: string;
  score: number;
  score_breakdown: MatchSignal[];
  job: {
    id: string;
    title: string;
    location: string | null;
    remote_type: string | null;
    salary_min: number | null;
    salary_max: number | null;
    salary_currency: string;
    apply_url: string;
    posted_at: string | null;
    company: { id: string; canonical_name: string } | null;
    ghost_signals: { risk_band: RiskBand; reasons: string[] }[] | null;
  };
}

export function useMatches() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["matches", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<MatchListItem[]> => {
      const { data, error } = await supabase
        .from("matches")
        .select(
          `id, score, score_breakdown,
           job:jobs (
             id, title, location, remote_type, salary_min, salary_max,
             salary_currency, apply_url, posted_at,
             company:companies ( id, canonical_name ),
             ghost_signals ( risk_band, reasons )
           )`
        )
        .eq("user_id", user!.id)
        .order("score", { ascending: false });

      if (error) throw error;

      const rows = (data ?? []) as unknown as RawMatchRow[];

      return rows.map((row) => ({
        id: row.id,
        score: row.score,
        score_breakdown: row.score_breakdown ?? [],
        job: row.job,
        ghost: row.job.ghost_signals?.[0] ?? null,
      }));
    },
  });
}
