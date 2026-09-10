import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  buildAnswerMessages,
  buildOpeningMessages,
  parseAnswerEval,
  parseOpening,
  PROMPT_VERSION,
  UnusableResponse,
  type CandidateContext,
  type InterviewMode,
  type JobContext,
  type Turn,
} from "./prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-task-secret",
};

const FEATURE = "interview_turn";
const CREDIT_COST = 1; // charged once, on 'start' — covers the whole session
const MODEL = "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const LLM_BUDGET_MS = Number(Deno.env.get("LLM_BUDGET_MS") ?? 100_000);
const LLM_TIMEOUT_MS = 45_000;
const MIN_RETRY_MS = 20_000;

// Hard cap, checked in code — not a suggestion in the prompt. This
// is the guardrail the roadmap calls non-negotiable for anything
// agentic: a loop deciding for itself when to stop is how an agent
// burns an inference budget silently.
const MAX_TURNS = 5;

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
      .select("id, user_id, task_type, status, input")
      .eq("id", requestedId)
      .single();

    if (taskErr || !task) {
      return json({ error: "No such task." }, 404);
    }
    if (task.task_type !== FEATURE) {
      return json({ error: "Wrong task type." }, 400);
    }

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
    if (!userId) {
      throw new Error("Task row has no user_id.");
    }

    const input = (task.input ?? {}) as Record<string, unknown>;
    const action = typeof input.action === "string" ? input.action : null;

    let resultPayload: Record<string, unknown>;

    if (action === "start") {
      resultPayload = await handleStart(supabase, userId, input);
      charged = resultPayload._charged === true;
      delete resultPayload._charged;
    } else if (action === "answer") {
      resultPayload = await handleAnswer(supabase, userId, input);
    } else {
      throw new UserFacing("That request didn't say whether to start or answer.");
    }

    const { error: doneErr } = await supabase
      .from("tasks")
      .update({ status: "done", result: resultPayload })
      .eq("id", taskId);

    if (doneErr) {
      console.error("could not mark the task done, retrying:", doneErr);
      const { error: retryErr } = await supabase
        .from("tasks")
        .update({ status: "done", result: resultPayload })
        .eq("id", taskId);
      if (retryErr) {
        console.error("second attempt to mark the task done failed:", retryErr);
        return json({ error: "The turn finished but the task could not be updated." }, 500);
      }
    }

    return json({ success: true });
  } catch (error) {
    let message =
      error instanceof UserFacing || error instanceof UnusableResponse
        ? error.message
        : "Something went wrong on our end.";

    console.error("interview-prep failed:", error);

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
        message = `${message} A credit was charged and could not be returned automatically — contact support and we'll put it back.`;
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

async function handleStart(
  supabase: SupabaseClient,
  userId: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const jobId = typeof input.job_id === "string" ? input.job_id : null;
  const mode = input.mode === "behavioral" || input.mode === "technical" ? (input.mode as InterviewMode) : null;
  if (!jobId || !mode) {
    throw new UserFacing("That request didn't say which job or which interview mode.");
  }

  const [{ data: profile }, { data: job }, { data: resume }] = await Promise.all([
    supabase.from("profiles").select("parsed").eq("id", userId).maybeSingle(),
    supabase
      .from("jobs")
      .select("id, title, description, company:companies ( canonical_name )")
      .eq("id", jobId)
      .maybeSingle(),
    supabase
      .from("resumes")
      .select("extracted_text")
      .eq("user_id", userId)
      .order("is_primary", { ascending: false })
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!job) {
    throw new UserFacing("That job isn't in the database any more.");
  }

  const parsedProfile = (profile?.parsed ?? {}) as Record<string, unknown>;
  const skills = Array.isArray(parsedProfile.skills)
    ? (parsedProfile.skills as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  const candidate: CandidateContext = {
    skills,
    resumeText: resume?.extracted_text?.trim() || null,
  };
  const jobCtx: JobContext = {
    title: job.title,
    companyName: (job.company as { canonical_name?: string } | null)?.canonical_name ?? null,
    description: job.description ?? "",
  };

  // Charged before the model call, refunded on any failure below —
  // same reasoning as every other credit-charging function here.
  const { data: ok, error: creditErr } = await supabase.rpc("consume_credit", {
    p_user_id: userId,
    p_feature: FEATURE,
    p_credits: CREDIT_COST,
  });
  if (creditErr) throw creditErr;
  if (ok !== true) {
    throw new UserFacing("You're out of credits for this month.");
  }

  let question: string;
  try {
    question = await generateWithRetry(() => buildOpeningMessages(mode, jobCtx, candidate), (raw) =>
      parseOpening(raw)
    );
  } catch (e) {
    // Refund needs to happen even though this isn't the outer catch —
    // the caller only refunds when `charged` is true, and it won't
    // know a charge happened unless this function reports it.
    await supabase.rpc("refund_credit", { p_user_id: userId, p_feature: FEATURE, p_credits: CREDIT_COST });
    throw e;
  }

  const turns: Turn[] = [{ question, answer: null, feedback: null, score: null }];

  const { data: session, error: insertErr } = await supabase
    .from("interview_sessions")
    .insert({
      user_id: userId,
      job_id: jobId,
      mode,
      status: "active",
      turns,
      turn_count: 1,
      max_turns: MAX_TURNS,
      model: MODEL,
    })
    .select("id, mode, status, turns, turn_count, max_turns, summary")
    .single();

  if (insertErr || !session) {
    await supabase.rpc("refund_credit", { p_user_id: userId, p_feature: FEATURE, p_credits: CREDIT_COST });
    throw new Error(`Could not create the interview session: ${insertErr?.message}`);
  }

  return {
    _charged: true,
    session_id: session.id,
    mode: session.mode,
    status: session.status,
    turns: session.turns,
    turn_count: session.turn_count,
    max_turns: session.max_turns,
    job_title: jobCtx.title,
    company_name: jobCtx.companyName,
  };
}

async function handleAnswer(
  supabase: SupabaseClient,
  userId: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const sessionId = typeof input.session_id === "string" ? input.session_id : null;
  const answer = typeof input.answer === "string" ? input.answer.trim() : "";
  if (!sessionId) {
    throw new UserFacing("That request didn't say which session to continue.");
  }
  if (!answer) {
    throw new UserFacing("That answer was empty.");
  }

  const { data: session, error: sessionErr } = await supabase
    .from("interview_sessions")
    .select("id, user_id, job_id, mode, status, turns, turn_count, max_turns")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionErr || !session) {
    throw new UserFacing("That interview session doesn't exist any more.");
  }
  if (session.user_id !== userId) {
    // Re-read from the row, never trust the body — same posture as
    // every other function here. A mismatch means the task's own
    // user_id and the session it named disagree; refuse rather than
    // silently acting on someone else's session.
    throw new UserFacing("That session doesn't belong to this account.");
  }
  if (session.status !== "active") {
    throw new UserFacing("That interview has already finished.");
  }

  const turns = (session.turns as Turn[]) ?? [];
  const currentIndex = turns.findIndex((t) => t.answer === null);
  if (currentIndex === -1) {
    throw new UserFacing("There's no open question waiting for an answer on this session.");
  }
  turns[currentIndex] = { ...turns[currentIndex], answer };

  const [{ data: profile }, { data: job }, { data: resume }] = await Promise.all([
    supabase.from("profiles").select("parsed").eq("id", userId).maybeSingle(),
    supabase
      .from("jobs")
      .select("id, title, description, company:companies ( canonical_name )")
      .eq("id", session.job_id)
      .maybeSingle(),
    supabase
      .from("resumes")
      .select("extracted_text")
      .eq("user_id", userId)
      .order("is_primary", { ascending: false })
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!job) {
    throw new UserFacing("That job isn't in the database any more.");
  }

  const parsedProfile = (profile?.parsed ?? {}) as Record<string, unknown>;
  const skills = Array.isArray(parsedProfile.skills)
    ? (parsedProfile.skills as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  const candidate: CandidateContext = { skills, resumeText: resume?.extracted_text?.trim() || null };
  const jobCtx: JobContext = {
    title: job.title,
    companyName: (job.company as { canonical_name?: string } | null)?.canonical_name ?? null,
    description: job.description ?? "",
  };

  const isFinalTurn = session.turn_count >= session.max_turns;
  const mode = session.mode as InterviewMode;

  const evaluation = await generateWithRetry(
    () => buildAnswerMessages(mode, jobCtx, candidate, turns, isFinalTurn),
    (raw) => parseAnswerEval(raw, isFinalTurn)
  );

  turns[currentIndex] = { ...turns[currentIndex], feedback: evaluation.feedback, score: evaluation.score };

  let status: "active" | "completed" = "active";
  let summary: Record<string, unknown> | null = null;
  let newTurnCount = session.turn_count;

  if (evaluation.kind === "done") {
    status = "completed";
    summary = {
      overall_feedback: evaluation.summary.overallFeedback,
      strengths: evaluation.summary.strengths,
      areas_to_improve: evaluation.summary.areasToImprove,
    };
  } else {
    turns.push({ question: evaluation.nextQuestion, answer: null, feedback: null, score: null });
    newTurnCount = session.turn_count + 1;
  }

  const { data: updated, error: updateErr } = await supabase
    .from("interview_sessions")
    .update({ turns, turn_count: newTurnCount, status, summary })
    .eq("id", sessionId)
    .select("id, mode, status, turns, turn_count, max_turns, summary")
    .single();

  if (updateErr || !updated) {
    throw new Error(`Could not save the interview turn: ${updateErr?.message}`);
  }

  return {
    session_id: updated.id,
    mode: updated.mode,
    status: updated.status,
    turns: updated.turns,
    turn_count: updated.turn_count,
    max_turns: updated.max_turns,
    summary: updated.summary,
  };
}

async function generateWithRetry<T>(
  build: () => { role: "system" | "user"; content: string }[],
  parse: (raw: string) => T
): Promise<T> {
  const ATTEMPTS = 2;
  const deadline = Date.now() + LLM_BUDGET_MS;

  for (let attempt = 1; ; attempt++) {
    const remaining = deadline - Date.now();
    try {
      return parse(await callDeepSeek(build(), Math.min(LLM_TIMEOUT_MS, remaining)));
    } catch (e) {
      const budgetLeft = deadline - Date.now();
      const worthRetrying =
        e instanceof UnusableResponse && e.retryable && attempt < ATTEMPTS && budgetLeft > MIN_RETRY_MS;
      if (!worthRetrying) throw e;
      console.warn(`attempt ${attempt} unusable (${(e as Error).message}); retrying with ${budgetLeft}ms left`);
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
  timeoutMs: number
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
        temperature: 0.6,
        max_tokens: 700,
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
