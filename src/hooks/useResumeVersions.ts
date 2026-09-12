import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { extractResumeText } from "@/lib/extractText";

export interface ResumeVersion {
  id: string;
  version: number;
  file_name: string;
  storage_path: string;
  extracted_text: string | null;
  track_name: string | null;
  is_primary: boolean;
  created_at: string;
}

export function resumeVersionsKey(userId: string | undefined) {
  return ["resume-versions", userId] as const;
}

/**
 * The fuller resume list behind minors m01 (version manager + diff)
 * and m02 (per-track sets) — a separate query from `useResumes()` in
 * useApplications.ts (that one stays lean for the tracker drawer's
 * dropdown, which never needs `extracted_text`).
 */
export function useResumeVersions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: resumeVersionsKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<ResumeVersion[]> => {
      const { data, error } = await supabase
        .from("resumes")
        .select("id, version, file_name, storage_path, extracted_text, track_name, is_primary, created_at")
        .eq("user_id", user!.id)
        .order("version", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Onboarding is the only other insert path, and it only ever runs
 * once (OnboardingGate redirects away after `onboarded_at` is set) —
 * so before this, there was literally no way to add a second resume
 * version. Not marked primary by default: uploading a new version
 * shouldn't silently switch what every AI feature reads from.
 */
export function useUploadResumeVersion() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ file, trackName }: { file: File; trackName: string | null }) => {
      const text = await extractResumeText(file);

      const { data: existing } = await supabase
        .from("resumes")
        .select("version")
        .eq("user_id", user!.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVersion = (existing?.version ?? 0) + 1;

      const path = `${user!.id}/${Date.now()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage.from("resumes").upload(path, file);
      if (uploadErr) throw uploadErr;

      const { error: insertErr } = await supabase.from("resumes").insert({
        user_id: user!.id,
        version: nextVersion,
        storage_path: path,
        file_name: file.name,
        extracted_text: text,
        track_name: trackName,
        is_primary: false,
      });
      if (insertErr) throw insertErr;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: resumeVersionsKey(user?.id) }),
  });
}

/**
 * "Default per search" (m02): every AI feature that reads a resume
 * already orders by `is_primary desc` (generate-cover-letter,
 * optimize-resume, interview-prep, assisted-apply) — so switching
 * primary is how a track becomes "the" one those features use. No
 * transaction available client-side; a failed second write here
 * would leave two primaries, which every reader already tolerates
 * fine (`order by is_primary desc limit 1` just picks one).
 */
export function useSetPrimaryResume() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (resumeId: string) => {
      const { error: clearErr } = await supabase
        .from("resumes")
        .update({ is_primary: false })
        .eq("user_id", user!.id)
        .neq("id", resumeId);
      if (clearErr) throw clearErr;

      const { error: setErr } = await supabase
        .from("resumes")
        .update({ is_primary: true })
        .eq("id", resumeId)
        .eq("user_id", user!.id);
      if (setErr) throw setErr;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: resumeVersionsKey(user?.id) }),
  });
}

export function useDeleteResumeVersion() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (resume: { id: string; storage_path: string }) => {
      const { error: storageErr } = await supabase.storage
        .from("resumes")
        .remove([resume.storage_path]);
      if (storageErr) throw storageErr;

      const { error: deleteErr } = await supabase
        .from("resumes")
        .delete()
        .eq("id", resume.id)
        .eq("user_id", user!.id);
      if (deleteErr) throw deleteErr;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: resumeVersionsKey(user?.id) }),
  });
}
