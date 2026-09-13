import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Capture Any Job (browser extension backend) — a direct client-to-
// function call, not the internal TASK_DISPATCH_SECRET dispatch
// pattern: there's no server-to-server dispatch here, the extension
// calls this directly, same posture as parse-search-query/
// hybrid-search. Identity comes from the caller's own JWT, verified
// via a caller-scoped client — never from anything the client puts in
// the request body.
//
// Scope: capture and save only. No ATS form automation, no
// auto-apply — same line this app already draws for Assisted Apply
// (M15). This just gets a real posting the user is looking at, on
// any site, into their own Kanban tracker with one click.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RATE_LIMIT_BUCKET = "capture-job";
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SECONDS = 300;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} is not set in this function's environment.`);
  }
  return value;
}

function inferRemoteType(location: string): "remote" | "hybrid" | "onsite" {
  const l = location.toLowerCase();
  if (l.includes("remote")) return "remote";
  if (l.includes("hybrid")) return "hybrid";
  return "onsite";
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function domainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only." }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Not authenticated." }, 401);
  }

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const anonKey = requireEnv("SUPABASE_ANON_KEY");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    // Caller-scoped client: proves who is asking. getUser() needs the
    // JWT passed explicitly — the forwarded Authorization header
    // alone only reaches PostgREST/RPC calls, never the GoTrue auth
    // client itself. This exact omission has silently 401'd every
    // real caller in three other functions in this codebase
    // (admin-action, delete-my-account, and pre-fix hybrid-search/
    // parse-search-query) — see CLAUDE.md's m37 account.
    const callerClient: SupabaseClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await callerClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ error: "Not authenticated." }, 401);
    }
    const userId = userData.user.id;

    const { data: allowed, error: rateLimitErr } = await callerClient.rpc("check_rate_limit", {
      p_user_id: userId,
      p_bucket: RATE_LIMIT_BUCKET,
      p_limit: RATE_LIMIT_MAX,
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    });
    if (!rateLimitErr && allowed === false) {
      return json({ error: "Too many captures — try again in a few minutes." }, 429);
    }

    const body = await req.json().catch(() => ({}));
    if (
      typeof body.url !== "string" ||
      typeof body.title !== "string" ||
      typeof body.description !== "string"
    ) {
      return json({ error: "Missing url, title, or description." }, 400);
    }

    const url = body.url.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return json({ error: "Invalid URL." }, 400);
    }
    const title = body.title.trim();
    const description = body.description.trim();
    if (!title || !description) {
      return json({ error: "Title and description cannot be empty." }, 400);
    }
    const location = typeof body.location === "string" ? body.location.trim() : "";
    const companyName = typeof body.company === "string" ? body.company.trim() : "";
    const salaryMin = typeof body.salaryMin === "number" ? body.salaryMin : null;
    const salaryMax = typeof body.salaryMax === "number" ? body.salaryMax : null;
    const salaryCurrency = typeof body.salaryCurrency === "string" ? body.salaryCurrency : null;

    // Service-role client for upserts. Same two-client pattern as admin-action.
    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let companyId: string | null = null;
    if (companyName) {
      const parsedDomain = domainFromUrl(url);
      const { data: company, error: companyErr } = await serviceClient
        .from("companies")
        .upsert(
          {
            canonical_name: companyName,
            domain: parsedDomain, // might be null, that's fine
            // ats_type left null because this isn't an ATS feed
          },
          { onConflict: parsedDomain ? "domain" : undefined }
        )
        .select("id")
        .single();
      
      if (!companyErr && company) {
        companyId = company.id;
      }
    }

    const fingerprint = `manual:${await sha256Hex(url)}`;

    // Upserting first_seen_at unconditionally would reset it on every
    // re-capture of an already-known posting (by this user or anyone
    // else), corrupting the freshness badge (m09) and the ghost
    // detector's days-open scoring (0007) — same reason ingest-jobs
    // reads the existing row first instead of always stamping "now".
    // Found while testing this build.
    const { data: existingJobRow } = await serviceClient
      .from("jobs")
      .select("first_seen_at")
      .eq("fingerprint", fingerprint)
      .maybeSingle();

    const { data: job, error: jobErr } = await serviceClient
      .from("jobs")
      .upsert(
        {
          company_id: companyId,
          title,
          description,
          location,
          remote_type: inferRemoteType(location),
          source: "manual",
          apply_url: url,
          fingerprint,
          first_seen_at: existingJobRow?.first_seen_at ?? new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          is_active: true,
          ...(salaryMin !== null ? { salary_min: salaryMin } : {}),
          ...(salaryMax !== null ? { salary_max: salaryMax } : {}),
          ...(salaryCurrency !== null ? { salary_currency: salaryCurrency } : {}),
        },
        { onConflict: "fingerprint" }
      )
      .select("id")
      .single();

    if (jobErr || !job) {
      console.error("Job upsert failed:", jobErr);
      return json({ error: "Failed to save job details." }, 500);
    }

    // Now save to the user's tracker
    const { data: existingApp } = await serviceClient
      .from("applications")
      .select("stage")
      .eq("user_id", userId)
      .eq("job_id", job.id)
      .maybeSingle();

    if (existingApp) {
      return json({ success: true, job_id: job.id, already_tracked: true, stage: existingApp.stage });
    }

    const { error: appErr } = await serviceClient
      .from("applications")
      .insert({
        user_id: userId,
        job_id: job.id,
        stage: "saved",
      });

    if (appErr) {
      console.error("Application insert failed:", appErr);
      return json({ error: "Failed to add to your tracker." }, 500);
    }

    return json({ success: true, job_id: job.id, already_tracked: false, stage: "saved" });
  } catch (error) {
    console.error("capture-job failed:", error);
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
