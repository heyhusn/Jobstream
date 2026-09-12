import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

/**
 * Minor m18: negative keyword filters ("no clearance required",
 * "not an agency posting") — a plain substring exclusion against a
 * job's title + description, same honesty level as the NL search's
 * own keyword matching (useNaturalLanguageSearch.ts). Not a hard
 * database filter (a keyword could be anything, not a column), so
 * `matchesNegativeKeywords` runs client-side against whatever job
 * list Matches/Search already loaded — same tradeoff as the company
 * blocklist and the alert filter.
 */
const negativeKeywordsTable = () => supabase.from("negative_keywords" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export interface NegativeKeyword {
  id: string;
  keyword: string;
}

export function negativeKeywordsKey(userId: string | undefined) {
  return ["negative-keywords", userId] as const;
}

export function useNegativeKeywords() {
  const { user } = useAuth();
  return useQuery({
    queryKey: negativeKeywordsKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<NegativeKeyword[]> => {
      const { data, error } = await negativeKeywordsTable()
        .select("id, keyword")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as NegativeKeyword[];
    },
  });
}

export function useAddNegativeKeyword() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = negativeKeywordsKey(user?.id);

  return useMutation({
    mutationFn: async (keyword: string) => {
      const { error } = await negativeKeywordsTable().insert({
        user_id: user!.id,
        keyword: keyword.trim().toLowerCase(),
      });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useRemoveNegativeKeyword() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = negativeKeywordsKey(user?.id);

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await negativeKeywordsTable().delete().eq("id", id).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

/** Excludes a job whose title or description contains any of the given (already-lowercased) keywords. */
export function matchesNegativeKeywords(
  job: { title: string; description?: string },
  keywords: string[]
): boolean {
  if (keywords.length === 0) return true;
  const haystack = `${job.title} ${job.description ?? ""}`.toLowerCase();
  return !keywords.some((k) => haystack.includes(k));
}
