import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  buildMessages,
  parseSkillGapResult,
  PROMPT_VERSION,
  UnusableResponse,
  type JobSnippet,
  type SkillGapContext,
} from "./prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-task-secret",
};

const FEATURE = "skill_gap";
const CREDIT_COST = 1;
const MODEL = "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
// Same reasoning as generate-cover-letter: an explicit shared budget
// rather than a per-attempt timeout, so a killed worker can't strand
// a charged credit on a task stuck at "running" forever.
const LLM_BUDGET_MS = Number(Deno.env.get("LLM_BUDGET_MS") ?? 100_000);
const LLM_TIMEOUT_MS = 45_000;
const MIN_RETRY_MS = 20_000;

// How many of the person's target postings to ground the analysis
// in. Capped so the prompt stays a fixed, predictable size regardless
// of how many jobs are in the database — ingestion can add hundreds
// without this function's cost or latency moving.
const MAX_JOBS = 15;

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
  let taskId: string | null = null;
  let userId: string | null = null;
  let charged = false;

  try {
    const payload = await req.json().catch(() => ({}));
    const requestedId = payload?.record?.id ?? payload?.task_id;
    if (typeof requestedId !== "string") {
      return json({ error: "No task id in the request." }, 400);
    }

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("id, user_id, task_type, status")
      .eq("id", requestedId)
      .single();

    if (taskErr || !task) {
      return json({ error: "No such task." }, 404);
    }
    if (task.task_type !== FEATURE) {
      return json({ error: "Wrong task type." }, 400);
    }

    // Conditional claim, same reasoning as generate-cover-letter:
    // pg_net can deliver the same webhook twice, and reading status
    // before trusting it lets both deliveries through — two charges
    // for one analysis.
    const { data: claimed, error: claimErr } = await supabase
      .from("tasks")
      .update({ status: "running" })
      .eq("id", task.id)
      .eq("status", "queued")
      .select("id");

    if (claimErr) throw claimErr;
    if (!claimed || claimed.length === 0) {
      return json({ skipped: "Task is already claimed." }, 200);
    }

    taskId = task.id;
    userId = task.user_id;

    // ── gather context ────────────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("parsed, years_experience")
      .eq("id", userId)
      .maybeSingle();

    const parsedProfile = (profile?.parsed ?? {}) as Record<string, unknown>;
    const skills = Array.isArray(parsedProfile.skills)
      ? (parsedProfile.skills as unknown[]).filter((s): s is string => typeof s === "string")
      : [];
    const yearsExperience =
      typeof profile?.years_experience === "number"
        ? profile.years_experience
        : typeof parsedProfile.years_experience === "number"
          ? (parsedProfile.years_experience as number)
          : null;

    if (skills.length === 0) {
      throw new UserFacing(
        "There's no parsed profile to work from yet. Finish onboarding first."
      );
    }

    // Target roles: the person's own highest-scored active matches
    // first (that's what "target" means once matching has run), and
    // a fallback to the most recently seen active postings for
    // someone who hasn't recomputed matches yet — the analysis
    // shouldn't hard-block on a click order.
    const { data: matchRows } = await supabase
      .from("matches")
      .select("score, job:jobs!inner ( id, title, description, is_active, company:companies ( canonical_name ) )")
      .eq("user_id", userId)
      .eq("job.is_active", true)
      .order("score", { ascending: false })
      .limit(MAX_JOBS);

    let jobs: JobSnippet[] = (matchRows ?? [])
      .map((r) => r.job as unknown as { title: string; description: string; company: { canonical_name?: string } | null })
      .filter(Boolean)
      .map((j) => ({
        title: j.title,
        companyName: j.company?.canonical_name ?? null,
        description: j.description ?? "",
      }));

    if (jobs.length === 0) {
      const { data: recentJobs } = await supabase
        .from("jobs")
        .select("title, description, company:companies ( canonical_name )")
        .eq("is_active", true)
        .order("last_seen_at", { ascending: false })
        .limit(MAX_JOBS);
      jobs = (recentJobs ?? []).map((j) => ({
        title: j.title,
        companyName: (j.company as { canonical_name?: string } | null)?.canonical_name ?? null,
        description: j.description ?? "",
      }));
    }

    if (jobs.length === 0) {
      throw new UserFacing("There aren't any job postings to compare your profile against yet.");
    }

    const ctx: SkillGapContext = { skills, yearsExperience, jobs };

    // ── cost guardrail, then charge, then generate ────────────
    // See 0017_cost_guardrails.sql — a user's own credit balance
    // only protects against that user overusing their own allowance,
    // not against the whole app's total DeepSeek spend.
    const { data: budgetOk, error: budgetErr } = await supabase.rpc("cost_budget_ok");
    if (budgetErr) throw budgetErr;
    if (budgetOk === false) {
      throw new UserFacing(
        "AI features are temporarily paused — today's model budget has been reached. Try again after midnight UTC."
      );
    }

    charged = true;
    const { data: ok, error: creditErr } = await supabase.rpc("consume_credit", {
      p_user_id: userId,
      p_feature: FEATURE,
      p_credits: CREDIT_COST,
    });
    if (creditErr) throw creditErr;
    if (ok !== true) {
      charged = false;
      throw new UserFacing("You're out of credits for this month.");
    }

    const result = await generateWithRetry(ctx, supabase, userId, taskId);

    // ── persist ───────────────────────────────────────────────
    // No dedicated table for this one — like parse_resume, the
    // result lives on the task row itself, and the client reads the
    // most recent completed skill_gap task to show it again later.
    const { error: doneErr } = await supabase
      .from("tasks")
      .update({
        status: "done",
        result: {
          gaps: result.gaps.map((g) => ({
            skill: g.skill,
            mentioned_in: g.mentionedIn,
            why_it_matters: g.whyItMatters,
            resource: g.resource,
          })),
          strengths: result.strengths,
          narrative: result.narrative,
          jobs_considered: jobs.length,
          model: MODEL,
          prompt_version: PROMPT_VERSION,
        },
      })
      .eq("id", taskId);

    if (doneErr) {
      console.error("could not mark the task done, retrying:", doneErr);
      const { error: retryErr } = await supabase
        .from("tasks")
        .update({ status: "done", result: { gaps: result.gaps, strengths: result.strengths, narrative: result.narrative, jobs_considered: jobs.length, model: MODEL } })
        .eq("id", taskId);
      if (retryErr) {
        console.error("second attempt to mark the task done failed:", retryErr);
        return json({ error: "The analysis finished but the task could not be updated." }, 500);
      }
    }

    return json({ success: true, gaps: result.gaps.length, jobs_considered: jobs.length });
  } catch (error) {
    let message =
      error instanceof UserFacing || error instanceof UnusableResponse
        ? error.message
        : "Something went wrong on our end. You haven't been charged.";

    console.error("analyze-skill-gap failed:", error);

    if (supabase && userId && charged) {
      let refunded = false;
      try {
        const { data, error: refundErr } = await supabase.rpc("refund_credit", {
          p_user_id: userId,
          p_feature: FEATURE,
          p_credits: CREDIT_COST,
        });
        if (refundErr) console.error("refund failed:", refundErr);
        refunded = data === true;
      } catch (e) {
        console.error("refund threw:", e);
      }

      if (!refunded) {
        console.error(`STRANDED CREDIT: user=${userId} task=${taskId} feature=${FEATURE}`);
        message = `${message.replace(" You haven't been charged.", "")} A credit was charged and could not be returned automatically — contact support and we'll put it back.`;
      }
    }

    if (supabase && taskId) {
      try {
        await supabase.from("tasks").update({ status: "failed", error: message }).eq("id", taskId);
      } catch (e) {
        console.error("could not mark the task failed:", e);
      }
    }

    return json({ error: message }, 500);
  }
});

async function generateWithRetry(
  ctx: SkillGapContext,
  supabase: SupabaseClient,
  userId: string | null,
  taskId: string | null
) {
  const ATTEMPTS = 2;
  const deadline = Date.now() + LLM_BUDGET_MS;

  for (let attempt = 1; ; attempt++) {
    const remaining = deadline - Date.now();
    try {
      return parseSkillGapResult(
        await callDeepSeek(buildMessages(ctx), Math.min(LLM_TIMEOUT_MS, remaining), {
          supabase,
          userId,
          taskId,
        })
      );
    } catch (e) {
      const budgetLeft = deadline - Date.now();
      const worthRetrying =
        e instanceof UnusableResponse &&
        e.retryable &&
        attempt < ATTEMPTS &&
        budgetLeft > MIN_RETRY_MS;

      if (!worthRetrying) throw e;
      console.warn(`attempt ${attempt} unusable (${e.message}); retrying with ${budgetLeft}ms left`);
    }
  }
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} is not set in this function's environment.`);
  }
  return value;
}

async function callDeepSeek(
  messages: { role: string; content: string }[],
  timeoutMs: number,
  usageCtx: { supabase: SupabaseClient; userId: string | null; taskId: string | null }
): Promise<string> {
  const key = Deno.env.get("DEEPSEEK_API_KEY");
  if (!key) {
    throw new Error("DEEPSEEK_API_KEY is not set in this function's environment.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, 1));

  try {
    const response = await fetch(Deno.env.get("DEEPSEEK_BASE_URL") ?? DEEPSEEK_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.4,
        max_tokens: 1500,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 429) {
        throw new UnusableResponse("The model is rate-limited right now. Try again in a minute.");
      }
      throw new Error(`DeepSeek returned ${response.status}: ${detail.slice(0, 500)}`);
    }

    const data = await response.json();

    // Logged for every real response received, successful content or
    // not — DeepSeek billed for this call either way. Never let a
    // logging failure break a generation that otherwise succeeded.
    try {
      await usageCtx.supabase.rpc("log_llm_usage", {
        p_user_id: usageCtx.userId,
        p_task_id: usageCtx.taskId,
        p_feature: FEATURE,
        p_prompt_tokens: data?.usage?.prompt_tokens ?? 0,
        p_completion_tokens: data?.usage?.completion_tokens ?? 0,
      });
    } catch (e) {
      console.error("log_llm_usage failed:", e);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new UnusableResponse("The model returned an empty response.", true);
    }
    return content;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new UnusableResponse("The model took too long to answer. Try again.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

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
