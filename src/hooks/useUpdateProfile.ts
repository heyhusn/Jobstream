import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export interface ProfileUpdateInput {
  skills: string[];
  years_experience: number | null;
  remote_preference: "remote" | "hybrid" | "onsite" | "no_preference";
  salary_floor: number | null;
  salary_currency: string;
  work_authorisation: string | null;
  github_url: string | null;
  portfolio_url: string | null;
}

/**
 * Onboarding was previously the only way to touch the profile —
 * this is the first post-onboarding edit path, added alongside the
 * roadmap's minor m05 (portfolio/GitHub links) and m06 (completeness
 * meter), since both need somewhere to actually edit the fields they
 * reference.
 */
export function useUpdateProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: ProfileUpdateInput) => {
      const { error } = await supabase
        .from("profiles")
        .update({
          parsed: { skills: input.skills },
          years_experience: input.years_experience,
          remote_preference: input.remote_preference,
          salary_floor: input.salary_floor,
          salary_currency: input.salary_currency,
          work_authorisation: input.work_authorisation,
          github_url: input.github_url,
          portfolio_url: input.portfolio_url,
        })
        .eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
  });
}
