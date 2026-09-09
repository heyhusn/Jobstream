import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { CoverLetterTone } from "@/types/database";

export interface CoverLetter {
  id: string;
  job_id: string;
  application_id: string | null;
  subject: string | null;
  body: string;
  tone: CoverLetterTone;
  notes: string | null;
  model: string;
  edited: boolean;
  generated_at: string;
  updated_at: string;
}

/** What the Edge Function reports back on the task row. */
export interface CoverLetterTaskResult extends Record<string, unknown> {
  cover_letter_id: string;
  job_id: string;
  placeholders: string[];
  model: string;
}

export function coverLetterKey(userId: string | undefined, jobId: string) {
  return ["cover-letter", userId, jobId] as const;
}

export function useCoverLetter(jobId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: coverLetterKey(user?.id, jobId ?? "none"),
    enabled: !!user && !!jobId,
    queryFn: async (): Promise<CoverLetter | null> => {
      const { data, error } = await supabase
        .from("cover_letters")
        .select(
          "id, job_id, application_id, subject, body, tone, notes, model, edited, generated_at, updated_at"
        )
        .eq("user_id", user!.id)
        .eq("job_id", jobId!)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });
}

/**
 * Saves an edit to the letter text.
 *
 * Only `subject` and `body` are sendable — a database trigger pins
 * the rest — so this can't quietly rewrite who wrote the letter or
 * when. `edited` comes back true from that same trigger.
 */
export function useUpdateCoverLetter(jobId: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = coverLetterKey(user?.id, jobId ?? "none");

  return useMutation({
    mutationFn: async ({ id, subject, body }: { id: string; subject?: string | null; body?: string }) => {
      const patch: { subject?: string | null; body?: string } = {};
      if (subject !== undefined) patch.subject = subject;
      if (body !== undefined) patch.body = body;

      const { error } = await supabase
        .from("cover_letters")
        .update(patch)
        .eq("id", id)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onMutate: async ({ subject, body }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<CoverLetter | null>(key);
      qc.setQueryData<CoverLetter | null>(key, (old) =>
        old
          ? {
              ...old,
              ...(subject !== undefined ? { subject } : {}),
              ...(body !== undefined ? { body } : {}),
              edited: true,
            }
          : old
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous !== undefined) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useDeleteCoverLetter(jobId: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = coverLetterKey(user?.id, jobId ?? "none");

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("cover_letters")
        .delete()
        .eq("id", id)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => qc.setQueryData(key, null),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
