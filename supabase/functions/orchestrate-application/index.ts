import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Agent Orchestration (roadmap M17), scoped as a fixed, inspectable
 * two-step state machine over agents that already exist — not an
 * open-ended agent loop. This function only ever handles one thing:
 * a freshly-queued `agent_run` task, dispatched here the same way
 * every other task type is dispatched (see handle_new_task). It
 * claims that task, creates the `agent_runs` row, and hands off to
 * `public.advance_agent_run`, a SQL function that owns every
 * subsequent step transition.
 *
 * Advancing used to happen here too, over a second HTTP hop: a
 * trigger on the child tasks would POST a "wake up" request back to
 * this function, which re-read state and decided what to do next.
 * That re-read was not an atomic claim, and pg_net's at-least-once
 * delivery could land two overlapping wake-ups that both saw the
 * same step as pending and both dispatched it — one logical step,
 * two credit charges. `advance_agent_run` now does that decision
 * inside one `select ... for update`-guarded transaction, and the
 * trigger calls it directly instead of posting a webhook to itself,
 * so there is no network delivery left to duplicate. See
 * 0016_fix_agent_orchestration_race.sql for the full story.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-task-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

class UserFacing extends Error {}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const expectedSecret = Deno.env.get("TASK_DISPATCH_SECRET");
  if (!expectedSecret) {
    console.error("TASK_DISPATCH_SECRET is not set; refusing every request.");
    return json({ error: "This function is not configured." }, 503);
  }
  if (!timingSafeEqual(req.headers.get("x-task-secret"), expectedSecret)) {
    return json({ error: "Not authorised." }, 401);
  }

  let supabase: SupabaseClient | null = null;
  let parentTaskId: string | null = null;
  let runId: string | null = null;

  try {
    const payload = await req.json().catch(() => ({}));
    const requestedTaskId = payload?.record?.id;
    if (typeof requestedTaskId !== "string") {
      return json({ error: "No task id in the request." }, 400);
    }

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: parent, error: taskErr } = await supabase
      .from("tasks")
      .select("id, user_id, task_type, status, input")
      .eq("id", requestedTaskId)
      .single();

    if (taskErr || !parent) {
      return json({ error: "No such task." }, 404);
    }
    if (parent.task_type !== "agent_run") {
      return json({ error: "Wrong task type." }, 400);
    }

    const input = (parent.input ?? {}) as Record<string, unknown>;
    const jobId = typeof input.job_id === "string" ? input.job_id : null;
    const applicationId = typeof input.application_id === "string" ? input.application_id : null;
    if (!jobId) {
      throw new UserFacing("That request didn't say which job to prepare.");
    }

    // The parent task comes from the application drawer, but the
    // relationship is re-checked server-side. A forged task input
    // must not attach a run to somebody else's application merely
    // because its id was learned or guessed.
    if (applicationId) {
      const { data: application, error: applicationError } = await supabase
        .from("applications")
        .select("id")
        .eq("id", applicationId)
        .eq("user_id", parent.user_id)
        .eq("job_id", jobId)
        .maybeSingle();
      if (applicationError) throw applicationError;
      if (!application) {
        throw new UserFacing("That application no longer belongs to this job.");
      }
    }

    // Conditional claim, same reasoning as every other dispatch in
    // this codebase: pg_net retries on timeout, so two deliveries of
    // this same webhook are routine, and only the delivery whose
    // UPDATE actually matches a still-queued row should create a run.
    const { data: claimed, error: claimErr } = await supabase
      .from("tasks")
      .update({ status: "running" })
      .eq("id", parent.id)
      .eq("status", "queued")
      .select("id");

    if (claimErr) throw claimErr;
    if (!claimed || claimed.length === 0) {
      return json({ skipped: "Task is already claimed." });
    }

    parentTaskId = parent.id;

    const { data: run, error: runError } = await supabase
      .from("agent_runs")
      .insert({
        user_id: parent.user_id,
        job_id: jobId,
        application_id: applicationId,
        parent_task_id: parent.id,
        status: "running",
        current_step: "resume_optimize",
        steps: [
          { kind: "resume_optimize", status: "pending" },
          { kind: "cover_letter", status: "pending" },
        ],
      })
      .select("id")
      .single();

    if (runError || !run) {
      throw runError ?? new Error("Could not create the application run.");
    }
    runId = run.id;

    const { error: advanceError } = await supabase.rpc("advance_agent_run", {
      p_run_id: run.id,
    });
    if (advanceError) throw advanceError;

    return json({ success: true, run_id: run.id });
  } catch (error) {
    const message =
      error instanceof UserFacing
        ? error.message
        : "Something went wrong preparing this application.";

    console.error("orchestrate-application failed:", error);

    if (supabase && runId) {
      await supabase.from("agent_runs").update({ status: "failed", error: message }).eq("id", runId);
    }
    if (supabase && parentTaskId) {
      await supabase.from("tasks").update({ status: "failed", error: message }).eq("id", parentTaskId);
    }

    return json({ error: message }, 500);
  }
});

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} is not set in this function's environment.`);
  }
  return value;
}

/**
 * Length-independent comparison. `!==` short-circuits on the first
 * differing byte, which leaks the secret one character at a time to
 * anyone patient enough to measure.
 */
function timingSafeEqual(a: string | null, b: string): boolean {
  if (a === null) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}
