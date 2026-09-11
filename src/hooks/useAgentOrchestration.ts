import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export type AgentStepKind = "resume_optimize" | "cover_letter";
export type AgentStepStatus = "pending" | "queued" | "running" | "done" | "skipped" | "failed";

export interface AgentStep { kind: AgentStepKind; status: AgentStepStatus; task_id?: string; error?: string }
export interface AgentRun {
  id: string; user_id: string; job_id: string; application_id: string | null;
  status: "queued" | "running" | "completed" | "failed";
  current_step: AgentStepKind | null; steps: AgentStep[]; error: string | null;
  created_at: string; updated_at: string;
}

// Service-role-only table; it stays outside the hand-written Database type.
function agentRunsTable() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase.from("agent_runs" as any);
}

export function agentRunKey(userId: string | undefined, jobId: string) { return ["agent-run", userId, jobId] as const; }

export function useLatestAgentRun(jobId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: agentRunKey(user?.id, jobId ?? "none"), enabled: !!user && !!jobId,
    queryFn: async (): Promise<AgentRun | null> => {
      const { data, error } = await agentRunsTable().select("id, user_id, job_id, application_id, status, current_step, steps, error, created_at, updated_at").eq("user_id", user!.id).eq("job_id", jobId!).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return (data as AgentRun | null) ?? null;
    },
    refetchInterval: (query) => {
      const run = query.state.data as AgentRun | null | undefined;
      return run?.status === "queued" || run?.status === "running" ? 2_500 : false;
    },
  });
}

export function useInFlightAgentRunTask(jobId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["agent-run-task", user?.id, jobId ?? "none"], enabled: !!user && !!jobId, staleTime: 0,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.from("tasks").select("id, input, created_at").eq("user_id", user!.id).eq("task_type", "agent_run").in("status", ["queued", "running"]).order("created_at", { ascending: false }).limit(10);
      if (error) throw error;
      return (data ?? []).find((task) => (task.input as { job_id?: string } | null)?.job_id === jobId)?.id ?? null;
    },
  });
}
