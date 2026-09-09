import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export function useCreditBalance() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["credit-balance", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_balances")
        .select("tier, credits_remaining, credits_reset_at")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Every credit-charging task updates this row; stay live rather
  // than making someone refresh the page to see their balance move.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`credits-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "credit_balances", filter: `user_id=eq.${user.id}` },
        () => queryClient.invalidateQueries({ queryKey: ["credit-balance", user.id] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  return query;
}
