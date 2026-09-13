import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export interface BoardCollaborator {
  id: string;
  owner_id: string;
  collaborator_email: string;
  collaborator_id: string | null;
  status: "pending" | "accepted";
  created_at: string;
}

// board_collaborators (migration 0036) isn't in the hand-written
// src/types/database.ts, same containment pattern as job_alerts —
// see useJobAlerts.ts.
const boardCollaboratorsTable = () => supabase.from("board_collaborators" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export function useCollaborators() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["board-collaborators", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<BoardCollaborator[]> => {
      const { data, error } = await boardCollaboratorsTable()
        .select("*")
        .eq("owner_id", user!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as unknown as BoardCollaborator[];
    },
  });
}

export function useInviteCollaborator() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (email: string) => {
      const { data, error } = await boardCollaboratorsTable()
        .insert({ owner_id: user!.id, collaborator_email: email })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board-collaborators", user?.id] }),
  });
}

export function useRemoveCollaborator() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await boardCollaboratorsTable()
        .delete()
        .eq("id", id)
        .eq("owner_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board-collaborators", user?.id] }),
  });
}

export function usePendingInvites() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ["board-invites", user?.email],
    enabled: !!user,
    queryFn: async (): Promise<BoardCollaborator[]> => {
      // The collaborator email policy handles reading our own invites
      const { data, error } = await boardCollaboratorsTable()
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as unknown as BoardCollaborator[];
    },
  });
}

export function useAcceptInvite() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await boardCollaboratorsTable()
        .update({ status: "accepted" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board-invites", user?.email] }),
  });
}
