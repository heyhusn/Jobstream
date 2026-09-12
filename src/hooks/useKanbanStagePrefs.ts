import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { STAGES } from "@/lib/stages";
import type { ApplicationStage } from "@/types/database";

/**
 * Minor m19: custom Kanban stages per user, scoped to what's safe on
 * a board already in production — see migration 0028's header
 * comment. `applications.stage` itself stays one of the fixed six
 * ids (the funnel view and the board's own drag-and-drop both key
 * off them); what's customizable is presentation: a renamed label,
 * a different column order, or hiding a column entirely.
 * `kanban_stage_prefs` isn't in the hand-written Database type —
 * same containment precedent as `saved_searches`.
 */
const prefsTable = () => supabase.from("kanban_stage_prefs" as any); // eslint-disable-line @typescript-eslint/no-explicit-any

export interface StagePref {
  stage_id: ApplicationStage;
  custom_label: string | null;
  position: number | null;
  hidden: boolean;
}

export interface EffectiveStage {
  id: ApplicationStage;
  label: string;
  terminal: boolean;
  emptyHint: string;
  hidden: boolean;
}

export function kanbanStagePrefsKey(userId: string | undefined) {
  return ["kanban-stage-prefs", userId] as const;
}

export function useKanbanStagePrefs() {
  const { user } = useAuth();
  return useQuery({
    queryKey: kanbanStagePrefsKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<StagePref[]> => {
      const { data, error } = await prefsTable()
        .select("stage_id, custom_label, position, hidden")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []) as unknown as StagePref[];
    },
  });
}

/** Merges saved prefs onto the fixed six stages, defaults for anything not customized. */
export function useEffectiveStages(): EffectiveStage[] {
  const { data: prefs } = useKanbanStagePrefs();

  return useMemo(() => {
    const byId = new Map((prefs ?? []).map((p) => [p.stage_id, p]));
    const merged = STAGES.map((s, i) => {
      const pref = byId.get(s.id);
      return {
        id: s.id,
        label: pref?.custom_label?.trim() || s.label,
        terminal: s.terminal,
        emptyHint: s.emptyHint,
        hidden: pref?.hidden ?? false,
        position: pref?.position ?? i,
      };
    });
    merged.sort((a, b) => a.position - b.position);
    return merged.map(({ position: _position, ...rest }) => rest);
  }, [prefs]);
}

export function useSetStagePref() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = kanbanStagePrefsKey(user?.id);

  return useMutation({
    mutationFn: async (pref: StagePref) => {
      const { error } = await prefsTable().upsert(
        { user_id: user!.id, ...pref },
        { onConflict: "user_id,stage_id" }
      );
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
