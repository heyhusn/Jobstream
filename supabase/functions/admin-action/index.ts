// Admin Console actions (roadmap M24), the part that turns the
// console from read-only monitoring into something an admin can
// actually operate. Before this function existed, ingest-jobs and
// send-notification could only be triggered by curl with
// TASK_DISPATCH_SECRET — a real secret that must never reach the
// browser bundle. This function holds that secret server-side and
// exposes three actions behind a completely different, browser-safe
// authorization check: the caller's own JWT, verified against
// Supabase Auth, then checked against is_admin() (migration
// 0020_admin_console.sql) — the exact same boundary every other
// admin RPC enforces. A non-admin gets 403 before anything runs.
//
// Identity comes from the caller's own bearer token, the same
// pattern as delete-my-account: never trust a client-supplied user
// id, always derive it from a token Supabase Auth itself validates.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACTIONS = ["ingest_jobs", "recompute_ghost_signals", "send_notification_digest"] as const;
type Action = (typeof ACTIONS)[number];

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

/** Forwards to another deployed function using this function's own
 *  TASK_DISPATCH_SECRET — the browser never sees it. */
async function callInternalFunction(
  supabaseUrl: string,
  anonKey: string,
  taskSecret: string,
  functionName: string
): Promise<{ ok: boolean; body: unknown }> {
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anonKey}`,
      "x-task-secret": taskSecret,
    },
    body: "{}",
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, body };
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

    // Scoped to the caller's own token — this is what actually
    // proves who is asking and lets is_admin() read the right
    // auth.uid(). A service-role client has no user context at all,
    // so this check has to happen on a client built from the real
    // bearer token, not the privileged one used further down.
    const callerClient: SupabaseClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Not authenticated." }, 401);
    }

    const { data: isAdmin, error: adminErr } = await callerClient.rpc("is_admin");
    if (adminErr) throw adminErr;
    if (isAdmin !== true) {
      return json({ error: "Not authorised." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action as Action | undefined;
    if (!action || !ACTIONS.includes(action)) {
      return json({ error: `action must be one of: ${ACTIONS.join(", ")}` }, 400);
    }

    if (action === "recompute_ghost_signals") {
      const serviceClient = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await serviceClient.rpc("recompute_all_ghost_signals");
      if (error) throw error;
      return json({ success: true, jobs_recomputed: data });
    }

    const taskSecret = Deno.env.get("TASK_DISPATCH_SECRET");
    if (!taskSecret) {
      return json({ error: "TASK_DISPATCH_SECRET is not configured on this function." }, 503);
    }

    const functionName = action === "ingest_jobs" ? "ingest-jobs" : "send-notification";
    const result = await callInternalFunction(supabaseUrl, anonKey, taskSecret, functionName);
    return json({ success: result.ok, result: result.body }, result.ok ? 200 : 502);
  } catch (error) {
    console.error("admin-action failed:", error);
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return json({ error: message }, 500);
  }
});
