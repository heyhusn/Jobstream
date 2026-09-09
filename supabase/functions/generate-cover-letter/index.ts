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

const FEATURE = "cover_letter";
const CREDIT_COST = 1;
const MODEL = "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const LLM_TIMEOUT_MS = 60_000;

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

  // The dispatcher sends a shared secret. When TASK_DISPATCH_SECRET
  // is set, nothing else gets in — this endpoint holds a
  // service-role client, so an unauthenticated caller who can shape
  // the request body would otherwise be acting as any user they
  // name. When it's unset the check is skipped so an unconfigured
  // project still works; see 0005_cover_letters.sql for how to
  // turn it on, and do.
  const expectedSecret = Deno.env.get("TASK_DISPATCH_SECRET");
  if (expectedSecret && req.headers.get("x-task-secret") !== expectedSecret) {
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
    // Idempotence: pg_net retries, and a replayed webhook must not
    // charge a second credit or overwrite a letter already written.
    if (task.status !== "queued") {
      return json({ skipped: `Task is already ${task.status}.` }, 200);
    }

    taskId = task.id;
    userId = task.user_id;

    await supabase.from("tasks").update({ status: "running" }).eq("id", taskId);

    const input = (task.input ?? {}) as Record<string, unknown>;
    const jobId = typeof input.job_id === "string" ? input.job_id : null;
    if (!jobId) {
      throw new UserFacing("That request didn't say which job to write about.");
    }
    const applicationId =
      typeof input.application_id === "string" ? input.application_id : null;
    const tone: Tone = isTone(input.tone) ? input.tone : "professional";
    const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : null;

    // ── gather context ────────────────────────────────────────
    const [{ data: profile }, { data: job }, { data: resume }] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, parsed, years_experience")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("jobs")
        .select("id, title, description, location, company:companies ( canonical_name )")
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
      jobTitle: job.title,
      companyName: (job.company as { canonical_name?: string } | null)?.canonical_name ?? null,
      jobLocation: job.location ?? null,
      jobDescription: job.description ?? "",
      tone,
      notes,
    };

    // ── charge, then generate ─────────────────────────────────
    // Charged first so two tabs can't both spend the last credit,
    // and refunded below on any failure. The alternative — charging
    // on success — lets someone run the model for free by hanging
    // up before the write.
    const { data: ok, error: creditErr } = await supabase.rpc("consume_credit", {
      p_user_id: userId,
      p_feature: FEATURE,
      p_credits: CREDIT_COST,
    });
    if (creditErr) throw creditErr;
    if (ok !== true) {
      throw new UserFacing("You're out of credits for this month.");
    }
    charged = true;

    const raw = await callDeepSeek(buildMessages(ctx));
    const letter = parseLetter(raw);

    // ── persist ───────────────────────────────────────────────
    const { data: saved, error: saveErr } = await supabase
      .from("cover_letters")
      .upsert(
        {
          user_id: userId,
          job_id: jobId,
          application_id: applicationId,
          subject: letter.subject,
          body: letter.body,
          tone,
          notes,
          model: MODEL,
          prompt_version: PROMPT_VERSION,
          edited: false,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,job_id" }
      )
      .select("id")
      .single();

    if (saveErr) throw saveErr;

    await supabase
      .from("tasks")
      .update({
        status: "done",
        result: {
          cover_letter_id: saved.id,
          job_id: jobId,
          placeholders: letter.placeholders,
          model: MODEL,
        },
      })
      .eq("id", taskId);

    return json({ success: true, cover_letter_id: saved.id });
  } catch (error) {
    const message =
      error instanceof UserFacing || error instanceof UnusableResponse
        ? error.message
        : "Something went wrong on our end. You haven't been charged.";

    console.error("generate-cover-letter failed:", error);

    if (supabase && userId && charged) {
      // Best effort, and wrapped: a query builder is a thenable,
      // not a Promise, so it has no .catch — and a throw here would
      // swallow the error the person actually needs to see and
      // leave the task stuck on "running" forever.
      try {
        const { error: refundErr } = await supabase.rpc("refund_credit", {
          p_user_id: userId,
          p_feature: FEATURE,
          p_credits: CREDIT_COST,
        });
        if (refundErr) console.error("refund failed:", refundErr);
      } catch (e) {
        console.error("refund threw:", e);
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

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} is not set in this function's environment.`);
  }
  return value;
}

async function callDeepSeek(messages: { role: string; content: string }[]): Promise<string> {
  // No literal fallback. A key committed to the repo is a key that
  // has to be rotated later, under worse circumstances.
  const key = Deno.env.get("DEEPSEEK_API_KEY");
  if (!key) {
    throw new Error("DEEPSEEK_API_KEY is not set in this function's environment.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(Deno.env.get("DEEPSEEK_BASE_URL") ?? DEEPSEEK_URL, {
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
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new UnusableResponse("The model took too long to answer. Try again.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // Rate limits and quota are the person's problem to wait out;
    // everything else is ours and stays generic.
    if (response.status === 429) {
      throw new UnusableResponse("The model is rate-limited right now. Try again in a minute.");
    }
    throw new Error(`DeepSeek returned ${response.status}: ${detail.slice(0, 500)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new UnusableResponse("The model returned an empty response.");
  }
  return content;
}
