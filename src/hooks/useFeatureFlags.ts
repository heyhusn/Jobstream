import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

/**
 * Minor m36: real staged-rollout infra, not a stub with nothing to
 * flip — `search_page_enabled` is seeded on by migration 0030, so
 * nothing changes for anyone today, but an admin can flip it off for
 * an instant rollback with no deploy. `feature_flags` isn't in the
 * hand-written Database type — same containment precedent as
 * `saved_searches`.
 */
const flagsTable = () => supabase.from("feature_flags" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export function useFeatureFlags() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["feature-flags", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, boolean>> => {
      const { data, error } = await flagsTable().select("key, enabled");
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((f: any) => [f.key, f.enabled])); // eslint-disable-line @typescript-eslint/no-explicit-any
    },
  });
}

/** Defaults to `true` while the flags query is loading — a flag failing to load shouldn't hide a feature that's on for everyone. */
export function useFeatureFlag(key: string): boolean {
  const { data } = useFeatureFlags();
  return data?.[key] ?? true;
}
