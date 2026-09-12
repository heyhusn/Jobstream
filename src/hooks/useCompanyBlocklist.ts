import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

/**
 * Minor m17: exclude-companies blocklist. `company_blocklist` isn't
 * in the hand-written Database type — same containment precedent as
 * `job_alerts`/`saved_searches`.
 */
const blocklistTable = () => supabase.from("company_blocklist" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export interface BlockedCompany {
  company_id: string;
  canonical_name: string;
}

export function companyBlocklistKey(userId: string | undefined) {
  return ["company-blocklist", userId] as const;
}

/** The current user's blocked company ids, as a Set for cheap `.has()` filtering on Matches/Search. */
export function useCompanyBlocklistIds() {
  const { user } = useAuth();
  return useQuery({
    queryKey: companyBlocklistKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await blocklistTable()
        .select("company_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return new Set((data ?? []).map((r: any) => r.company_id as string)); // eslint-disable-line @typescript-eslint/no-explicit-any
    },
  });
}

/** The full list with company names, for a management view (Settings). */
export function useBlockedCompanies() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...companyBlocklistKey(user?.id), "detail"],
    enabled: !!user,
    queryFn: async (): Promise<BlockedCompany[]> => {
      const { data, error } = await blocklistTable()
        .select("company_id, company:companies ( canonical_name )")
        .eq("user_id", user!.id);
      if (error) throw error;
      return ((data ?? []) as unknown as { company_id: string; company: { canonical_name: string } | null }[]).map(
        (r) => ({ company_id: r.company_id, canonical_name: r.company?.canonical_name ?? "Unknown company" })
      );
    },
  });
}

export function useBlockCompany() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (companyId: string) => {
      const { error } = await blocklistTable().insert({ user_id: user!.id, company_id: companyId });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: companyBlocklistKey(user?.id) }),
  });
}

export function useUnblockCompany() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (companyId: string) => {
      const { error } = await blocklistTable()
        .delete()
        .eq("user_id", user!.id)
        .eq("company_id", companyId);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: companyBlocklistKey(user?.id) }),
  });
}
