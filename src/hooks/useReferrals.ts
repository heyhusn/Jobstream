import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

/**
 * Minor m39: referral programme with credit rewards. `referral_code`
 * lives on `profiles` (typed there already); `referrals` isn't in
 * the hand-written Database type — same containment precedent as
 * `saved_searches`. The reward itself is granted server-side by
 * `grant_referral_reward()` (migration 0030) when the REFERRED
 * user's onboarding completes, never by a client write.
 */
const referralsTable = () => supabase.from("referrals" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Referral {
  id: string;
  referred_id: string;
  reward_granted: boolean;
  created_at: string;
}

export function useReferralCode() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["referral-code", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("referral_code")
        .eq("id", user!.id)
        .single();
      if (error) throw error;
      return data.referral_code;
    },
  });
}

export function useMyReferrals() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-referrals", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Referral[]> => {
      const { data, error } = await referralsTable()
        .select("id, referred_id, reward_granted, created_at")
        .eq("referrer_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Referral[];
    },
  });
}
