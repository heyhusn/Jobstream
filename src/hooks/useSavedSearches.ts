import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

/**
 * Minor m07: saved searches with one-click re-run, against the
 * hybrid Search page's free-text query (M03) — not the Matches
 * page's structured NL filter, which already has nowhere persistent
 * to save to since it re-parses a sentence into a filter object each
 * time rather than storing the sentence itself.
 *
 * `saved_searches` isn't in the hand-written Database type — same
 * containment precedent as `job_alerts` (see useJobAlerts.ts): one
 * untyped cast here, honest interfaces at every call site.
 */
const savedSearchesTable = () => supabase.from("saved_searches" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export interface SavedSearch {
  id: string;
  name: string;
  query_text: string;
  created_at: string;
}

export function savedSearchesKey(userId: string | undefined) {
  return ["saved-searches", userId] as const;
}

export function useSavedSearches() {
  const { user } = useAuth();
  return useQuery({
    queryKey: savedSearchesKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<SavedSearch[]> => {
      const { data, error } = await savedSearchesTable()
        .select("id, name, query_text, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SavedSearch[];
    },
  });
}

export function useCreateSavedSearch() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = savedSearchesKey(user?.id);

  return useMutation({
    mutationFn: async ({ name, query_text }: { name: string; query_text: string }) => {
      const { error } = await savedSearchesTable().insert({
        user_id: user!.id,
        name,
        query_text,
      });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useDeleteSavedSearch() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = savedSearchesKey(user?.id);

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await savedSearchesTable().delete().eq("id", id).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
