import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-task-secret",
};

type StepKind = "resume_optimize" | "cover_letter";
type StepStatus = "pending" | "queued" | "running" | "done" | "skipped" | "failed";
interface AgentStep { kind: StepKind; status: StepStatus; task_id?: string; error?: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

class UserFacing extends Error {}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const secret = Deno.env.get("TASK_DISPATCH_SECRET");
  if (!secret) return json({ error: "This function is not configured." }, 503);
  if (!timingSafeEqual(req.headers.get("x-task-secret"), secret)) return json({ error: "Not authorised." }, 401);

  let supabase: SupabaseClient | null = null;
  let parentTaskId: string | null = null;
  let runId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const requestedTaskId = body?.record?.id;
    const requestedRunId = typeof body?.run_id === "string" ? body.run_id : null;
    if (typeof requestedTaskId !== "string" && !requestedRunId) return json({ error: "No task or run id in the request." }, 400);

    const url = requireEnv("SUPABASE_URL");
    supabase = createClient(url, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });

    if (requestedTaskId) {
      const { data: parent, error } = await supabase.from("tasks").select("id, user_id, task_type, status, input").eq("id", requestedTaskId).single();
      if (error || !parent) return json({ error: "No such task." }, 404);
      if (parent.task_type !== "agent_run") return json({ error: "Wrong task type." }, 400);
      if (parent.status !== "queued") return json({ skipped: "Task is already claimed." });
      parentTaskId = parent.id;
      const input = (parent.input ?? {}) as Record<string, unknown>;
      const jobId = typeof input.job_id === "string" ? input.job_id : null;
      const applicationId = typeof input.application_id === "string" ? input.application_id : null;
      if (!jobId) throw new UserFacing("That request didn't say which job to prepare.");

      // The parent task comes from an application drawer, but re-check the
      // relationship server-side. A forged task input must not attach a run
      // to somebody else's application merely because its UUID was learned.
      if (applicationId) {
        const { data: application, error: applicationError } = await supabase
          .from("applications")
          .select("id")
          .eq("id", applicationId)
          .eq("user_id", parent.user_id)
          .eq("job_id", jobId)
          .maybeSingle();
        if (applicationError) throw applicationError;
        if (!application) throw new UserFacing("That application no longer belongs to this job.");
      }

      const { data: claimed, error: claimError } = await supabase.from("tasks").update({ status: "running" }).eq("id", parent.id).eq("status", "queued").select("id");
      if (claimError) throw claimError;
      if (!claimed?.length) return json({ skipped: "Task is already claimed." });

      const { data: run, error: runError } = await supabase.from("agent_runs").insert({
        user_id: parent.user_id, job_id: jobId, application_id: applicationId,
        status: "running", current_step: "resume_optimize",
        steps: [{ kind: "resume_optimize", status: "pending" }, { kind: "cover_letter", status: "pending" }],
      }).select("id").single();
      if (runError || !run) throw runError ?? new Error("Could not create the application run.");
      const createdRunId = run.id;
      runId = createdRunId;
      await advanceRun(supabase, createdRunId, parent.id);
      return json({ success: true, run_id: createdRunId });
    }

    const requestedExistingRunId = requestedRunId!;
    runId = requestedExistingRunId;
    const { data: run, error } = await supabase.from("agent_runs").select("id, user_id, job_id, application_id, status, current_step, steps").eq("id", requestedExistingRunId).single();
    if (error || !run) return json({ error: "No such run." }, 404);
    if (run.status === "completed" || run.status === "failed") return json({ skipped: "Run already finished." });

    const { data: parent } = await supabase.from("tasks").select("id").eq("task_type", "agent_run").eq("user_id", run.user_id).contains("result", { run_id: runId }).maybeSingle();
    // The parent is not in result until completion. Find it through the child task's input instead.
    const { data: child } = await supabase.from("tasks").select("input").contains("input", { agent_run_id: runId }).limit(1).maybeSingle();
    const linkedParentId = typeof (child?.input as Record<string, unknown> | null)?.parent_task_id === "string"
      ? (child!.input as Record<string, string>).parent_task_id : parent?.id;
    if (!linkedParentId) throw new Error("Run has no parent task.");
    await advanceRun(supabase, requestedExistingRunId, linkedParentId);
    return json({ success: true, run_id: requestedExistingRunId });
  } catch (error) {
    const message = error instanceof UserFacing ? error.message : "Something went wrong preparing this application.";
    console.error("orchestrate-application failed:", error);
    if (supabase && runId) await supabase.from("agent_runs").update({ status: "failed", error: message }).eq("id", runId);
    if (supabase && parentTaskId) await supabase.from("tasks").update({ status: "failed", error: message }).eq("id", parentTaskId);
    return json({ error: message }, 500);
  }
});

async function advanceRun(supabase: SupabaseClient, runId: string, parentTaskId: string) {
  const { data: run, error } = await supabase.from("agent_runs").select("id, user_id, job_id, application_id, status, current_step, steps").eq("id", runId).single();
  if (error || !run || run.status === "completed" || run.status === "failed") return;
  const steps = (Array.isArray(run.steps) ? run.steps : []) as AgentStep[];
  const current = steps.find((step) => step.kind === run.current_step);
  if (!current) throw new Error("Run has no current step.");

  if (current.status === "queued" || current.status === "running") {
    if (!current.task_id) throw new Error("Queued step has no task id.");
    const { data: child, error: childError } = await supabase.from("tasks").select("status, error").eq("id", current.task_id).single();
    if (childError || !child || (child.status !== "done" && child.status !== "failed")) return;
    current.status = child.status;
    if (child.error) current.error = child.error;
    if (child.status === "failed") {
      await finishRun(supabase, runId, parentTaskId, steps, "failed", child.error ?? "A preparation step didn't finish.");
      return;
    }
  }

  if (current.status === "pending") {
    const taskType = current.kind;
    const input: Record<string, unknown> = { job_id: run.job_id, agent_run_id: runId, parent_task_id: parentTaskId };
    if (taskType === "cover_letter") {
      const { data: letter, error: letterError } = await supabase.from("cover_letters").select("id").eq("user_id", run.user_id).eq("job_id", run.job_id).maybeSingle();
      if (letterError) throw letterError;
      if (letter) {
        current.status = "skipped";
        await supabase.from("agent_runs").update({ steps }).eq("id", runId).eq("status", "running");
        return advanceRun(supabase, runId, parentTaskId);
      }
      input.application_id = run.application_id;
      input.tone = "professional";
      input.notes = null;
    }
    const { data: task, error: taskError } = await supabase.from("tasks").insert({ user_id: run.user_id, task_type: taskType, input, status: "queued" }).select("id").single();
    if (taskError || !task) throw taskError ?? new Error("Could not start a preparation step.");
    current.status = "queued";
    current.task_id = task.id;
    await supabase.from("agent_runs").update({ steps }).eq("id", runId).eq("status", "running");
    return;
  }

  if (current.status === "done" || current.status === "skipped") {
    const next = steps.find((step) => step.status === "pending");
    if (!next) {
      await finishRun(supabase, runId, parentTaskId, steps, "completed", null);
      return;
    }
    await supabase.from("agent_runs").update({ current_step: next.kind, steps }).eq("id", runId).eq("status", "running");
    await advanceRun(supabase, runId, parentTaskId);
  }
}

async function finishRun(supabase: SupabaseClient, runId: string, parentTaskId: string, steps: AgentStep[], status: "completed" | "failed", error: string | null) {
  await supabase.from("agent_runs").update({ status, current_step: null, steps, error }).eq("id", runId).in("status", ["queued", "running"]);
  await supabase.from("tasks").update(status === "completed"
    ? { status: "done", result: { run_id: runId, steps } }
    : { status: "failed", error: error ?? "A preparation step didn't finish." }
  ).eq("id", parentTaskId).eq("status", "running");
}

function requireEnv(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`${name} is not set in this function's environment.`); return value; }
function timingSafeEqual(a: string | null, b: string) {
  if (a === null) return false;
  const x = new TextEncoder().encode(a); const y = new TextEncoder().encode(b); let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
