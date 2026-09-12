import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

/**
 * Minor m24: recruiter/contact notes attached to a company, not an
 * application — persists across every future application to the
 * same employer. `company_contacts` isn't in the hand-written
 * Database type — same containment precedent as `saved_searches`.
 */
const contactsTable = () => supabase.from("company_contacts" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export interface CompanyContact {
  id: string;
  contact_name: string | null;
  note: string;
  created_at: string;
}

export function companyContactsKey(userId: string | undefined, companyId: string | undefined) {
  return ["company-contacts", userId, companyId] as const;
}

export function useCompanyContacts(companyId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: companyContactsKey(user?.id, companyId),
    enabled: !!user && !!companyId,
    queryFn: async (): Promise<CompanyContact[]> => {
      const { data, error } = await contactsTable()
        .select("id, contact_name, note, created_at")
        .eq("user_id", user!.id)
        .eq("company_id", companyId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CompanyContact[];
    },
  });
}

export function useAddCompanyContact(companyId: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ contactName, note }: { contactName: string | null; note: string }) => {
      const { error } = await contactsTable().insert({
        user_id: user!.id,
        company_id: companyId!,
        contact_name: contactName,
        note,
      });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: companyContactsKey(user?.id, companyId) }),
  });
}

export function useDeleteCompanyContact(companyId: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await contactsTable().delete().eq("id", id).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: companyContactsKey(user?.id, companyId) }),
  });
}
