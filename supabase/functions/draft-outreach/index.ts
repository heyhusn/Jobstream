import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  buildMessages,
  isTone,
  parseLetter,
  PROMPT_VERSION,
  UnusableResponse,
  type LetterContext,
  type Tone,
} from "./prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-task-secret",
};

const FEATURE = "draft_outreach";
const CREDIT_COST = 1;
const MODEL = "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
// Supabase kills an Edge Function worker at its wall-clock cap —
// 150s on the free plan, 400s on paid. Blowing it is the worst
// failure this function has: the worker dies before the catch block
// runs, so the credit is spent, never refunded, and the task sits on
// "running" forever with the UI spinning at it.
//
// So the model calls get an explicit budget rather than a per-attempt
// timeout that multiplies by the retry count. 100s leaves 50s of the
// free plan's 150 for the six database round trips either side and
// for cold starts. Raise LLM_BUDGET_MS on a paid plan.
const LLM_BUDGET_MS = Number(Deno.env.get("LLM_BUDGET_MS") ?? 100_000);
const LLM_TIMEOUT_MS = 45_000;
// Below this there isn't enough left for a second attempt to finish,
// so the first error stands rather than being replaced by a timeout.
const MIN_RETRY_MS = 20_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Thrown for anything the person should see on their task row.
 * Everything else surfaces as a generic message — an upstream
 * error string can carry a key or a query in it.
 */
class UserFacing extends Error {}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // This endpoint holds a service-role client: an unauthenticated
  // caller who can shape the request body would be acting as
  // whatever user they name. So the shared secret is required, not
  // optional — an unset TASK_DISPATCH_SECRET refuses every request
  // rather than waving them all through. Deployment is two secrets
  // and one config row; see 0005_cover_letters.sql.
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
    // The id is the only thing taken from the request. Every other
    // fact — whose task it is, what it's for — is read back from
    // the row, so a forged body can at most re-run a task that
    // already exists.
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
      .select("id, user_id, task_type, status, input")
      .eq("id", requestedId)
      .single();

    if (taskErr || !task) {
      return json({ error: "No such task." }, 404);
    }
    if (task.task_type !== FEATURE) {
      return json({ error: "Wrong task type." }, 400);
    }

    // Claim the task with a conditional update rather than a read
    // followed by a write. pg_net retries on timeout, so two
    // deliveries of the same webhook overlap routinely; reading the
    // status and then trusting it lets both pass, both charge, and
    // the second letter overwrite the first — one letter, two
    // credits. Only the delivery whose UPDATE actually matched a
    // still-queued row proceeds.
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

    const input = (task.input ?? {}) as Record<string, unknown>;
    const jobId = typeof input.job_id === "string" ? input.job_id : null;
    const companyId = typeof input.company_id === "string" ? input.company_id : null;
    
    if (!jobId && !companyId) {
      throw new UserFacing("That request didn't say which job or company to write about.");
    }
    
    const tone: Tone = isTone(input.tone) ? input.tone : "professional";
    const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : null;

    // ── gather context ────────────────────────────────────────
    const [{ data: profile }, { data: job }, { data: company }, { data: resume }] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, parsed, years_experience")
        .eq("id", userId)
        .maybeSingle(),
      jobId ? supabase
        .from("jobs")
        .select("id, title, description, location, company:companies ( canonical_name )")
        .eq("id", jobId)
        .maybeSingle() : Promise.resolve({ data: null }),
      companyId ? supabase
        .from("companies")
        .select("id, canonical_name")
        .eq("id", companyId)
        .maybeSingle() : Promise.resolve({ data: null }),
      supabase
        .from("resumes")
        .select("extracted_text")
        .eq("user_id", userId)
        .order("is_primary", { ascending: false })
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (!job && !company) {
      throw new UserFacing("That job or company isn't in the database any more.");
    }

    const parsedProfile = (profile?.parsed ?? {}) as Record<string, unknown>;
    const skills = Array.isArray(parsedProfile.skills)
      ? (parsedProfile.skills as unknown[]).filter((s): s is string => typeof s === "string")
      : [];
    const resumeText = resume?.extracted_text?.trim() || null;

    if (!resumeText && skills.length === 0) {
      // Charging for a letter with nothing to write from would be
      // taking money for filler.
      throw new UserFacing(
        "There's no resume or parsed profile to write from yet. Finish onboarding first."
      );
    }

    const ctx: LetterContext = {
      fullName: profile?.full_name ?? null,
      yearsExperience:
        typeof profile?.years_experience === "number"
          ? profile.years_experience
          : typeof parsedProfile.years_experience === "number"
            ? (parsedProfile.years_experience as number)
            : null,
      skills,
      resumeText,
      jobTitle: job?.title ?? "General Application",
      companyName: (job?.company as { canonical_name?: string } | null)?.canonical_name ?? company?.canonical_name ?? null,
      jobLocation: job?.location ?? null,
      jobDescription: job?.description ?? "",
      tone,
      notes,
    };

    // ── cost guardrail, then charge, then generate ────────────
    // Checked before spending anything — a user's own credit balance
    // only protects against that one user overusing their own
    // allowance, not against the whole app's total DeepSeek spend.
    // See 0017_cost_guardrails.sql.
    const { data: budgetOk, error: budgetErr } = await supabase.rpc("cost_budget_ok");
    if (budgetErr) throw budgetErr;
    if (budgetOk === false) {
      throw new UserFacing(
        "AI features are temporarily paused — today's model budget has been reached. Try again after midnight UTC."
      );
    }

    // Charged first so two tabs can't both spend the last credit,
    // and refunded below on any failure. The alternative — charging
    // on success — lets someone run the model for free by hanging
    // up before the write.
    // Set before the await, not after: if the RPC commits and the
    // response is lost on the way back, the credit is spent and the
    // catch block still has to refund it. An unnecessary refund
    // attempt is safe — refund_credit refuses to give back more
    // than this feature actually charged.
    charged = true;
    const { data: ok, error: creditErr } = await supabase.rpc("consume_credit", {
      p_user_id: userId,
      p_feature: FEATURE,
      p_credits: CREDIT_COST,
    });
    if (creditErr) throw creditErr;
    if (ok !== true) {
      // Nothing was spent, so nothing needs putting back.
      charged = false;
      throw new UserFacing("You're out of credits for this month.");
    }

    // One retry on a garbled response. The credit is already spent,
    // so a second attempt costs an API call rather than another
    // credit — and a live bench run showed the model failing to
    // return usable JSON roughly one call in four. Failing the whole
    // task on the first stumble makes the person pay for our retry
    // with their time and a click.
    const letter = await generateWithRetry(ctx, supabase, userId, taskId);

    // ── persist ───────────────────────────────────────────────
    const { error: doneErr } = await supabase
      .from("tasks")
      .update({
        status: "done",
        result: {
          job_id: jobId,
          subject: letter.subject,
          body: letter.body,
          placeholders: letter.placeholders,
          model: MODEL,
        },
      })
      .eq("id", taskId);

    if (doneErr) {
      // The letter is written and the credit is spent; only the
      // task row failed to flip. The client watches that row, so
      // losing this write leaves a spinner next to a finished
      // letter. One retry, then report it rather than returning
      // success over a broken state.
      console.error("could not mark the task done, retrying:", doneErr);
      const { error: retryErr } = await supabase
        .from("tasks")
        .update({
          status: "done",
          result: {
            job_id: jobId,
            subject: letter.subject,
            body: letter.body,
            placeholders: letter.placeholders,
            model: MODEL,
          },
        })
        .eq("id", taskId);
      if (retryErr) {
        console.error("second attempt to mark the task done failed:", retryErr);
        return json(
          { error: "The letter was written but the task could not be updated." },
          500
        );
      }
    }

    return json({ success: true });
  } catch (error) {
    let message =
      error instanceof UserFacing || error instanceof UnusableResponse
        ? error.message
        : "Something went wrong on our end. You haven't been charged.";

    console.error("generate-cover-letter failed:", error);

    if (supabase && userId && charged) {
      // Wrapped, because a query builder is a thenable rather than a
      // Promise — it has no .catch, and a throw here would swallow
      // the error the person needs to see and leave the task stuck
      // on "running" forever.
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
        // Telling someone they weren't charged when they were is
        // worse than the original failure. Say what actually
        // happened so support has something to act on.
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
  ctx: LetterContext,
  supabase: SupabaseClient,
  userId: string | null,
  taskId: string | null
) {
  const ATTEMPTS = 2;
  const deadline = Date.now() + LLM_BUDGET_MS;

  for (let attempt = 1; ; attempt++) {
    const remaining = deadline - Date.now();
    try {
      return parseLetter(
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
      console.warn(
        `attempt ${attempt} unusable (${e.message}); retrying with ${budgetLeft}ms left`
      );
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
  // No literal fallback. A key committed to the repo is a key that
  // has to be rotated later, under worse circumstances.
  const key = Deno.env.get("DEEPSEEK_API_KEY");
  if (!key) {
    throw new Error("DEEPSEEK_API_KEY is not set in this function's environment.");
  }

  const controller = new AbortController();
  // Covers the body read as well as the headers, and is bounded by
  // what's left of the shared budget rather than a fixed per-attempt
  // value. A server that answers instantly and then stalls the body
  // would otherwise hang past every deadline with the credit already
  // spent — the worker gets killed on its wall-clock limit, the catch
  // block never runs, and the task sits on "running" forever.
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
        // Cover letters want some variation between regenerations,
        // but not invention — this is well below the 1.0 default.
        temperature: 0.7,
        max_tokens: 1200,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // Rate limits are the person's problem to wait out;
      // everything else is ours and stays generic.
      if (response.status === 429) {
        // Not retryable: hitting it again immediately is what a rate
        // limit is asking us not to do.
        throw new UnusableResponse("The model is rate-limited right now. Try again in a minute.");
      }
      throw new Error(`DeepSeek returned ${response.status}: ${detail.slice(0, 500)}`);
    }

    const data = await response.json();

    // Logged for every real response received, successful content or
    // not — DeepSeek billed for this call either way, and a garbled
    // response that gets retried is a second real charge, not a
    // do-over. Never let a logging failure break a generation that
    // otherwise succeeded.
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
