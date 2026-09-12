import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

/**
 * Minor m04: a personal library of reusable cover-letter snippets —
 * independent of AI generation (M11), inserted into any draft while
 * editing. `cover_letter_blocks` isn't in the hand-written Database
 * type — same containment precedent as `saved_searches`.
 */
const blocksTable = () => supabase.from("cover_letter_blocks" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export interface CoverLetterBlock {
  id: string;
  label: string;
  content: string;
}

export function coverLetterBlocksKey(userId: string | undefined) {
  return ["cover-letter-blocks", userId] as const;
}

export function useCoverLetterBlocks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: coverLetterBlocksKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<CoverLetterBlock[]> => {
      const { data, error } = await blocksTable()
        .select("id, label, content")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CoverLetterBlock[];
    },
  });
}

export function useCreateCoverLetterBlock() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = coverLetterBlocksKey(user?.id);

  return useMutation({
    mutationFn: async ({ label, content }: { label: string; content: string }) => {
      const { error } = await blocksTable().insert({ user_id: user!.id, label, content });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useDeleteCoverLetterBlock() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = coverLetterBlocksKey(user?.id);

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await blocksTable().delete().eq("id", id).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
