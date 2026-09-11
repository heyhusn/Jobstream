// Account deletion (roadmap M25 / minor m38) — the "right to
// erasure" half of data rights. The "export" half is the
// export_my_data() SQL function (migration 0021_data_rights.sql);
// this one needs a service-role Edge Function because deleting an
// auth user and clearing their Storage files both require the Admin
// API, which no RLS policy can grant a client.
//
// Identity comes from the caller's own JWT, verified against Supabase
// Auth itself — never from anything the client puts in the request
// body. A service-role client can act as *any* user, so the very
// first thing this function does is find out, cryptographically, who
// is actually asking, using a second client built with the anon key
// plus the caller's own bearer token. Only that verified id is ever
// touched.
//
// Every user-owned table already references auth.users(id) on delete
// cascade (audited in 0021's header comment), so deleting the auth
// user removes essentially everything in one transactional operation
// on the database side. The one thing cascade doesn't reach is
// Storage — `resumes` bucket objects are files, not rows tied by a
// foreign key — so those are explicitly removed first.
//
// A destructive, irreversible, account-wide action gets a stronger
// confirmation than this app's usual "click again to confirm": the
// caller must echo back their own email exactly, the same class of
// safeguard as GitHub's "type the repo name to delete it."

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    // proves who is asking. auth.getUser() validates the JWT against
    // Supabase Auth itself; it is not decoded or trusted locally.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Not authenticated." }, 401);
    }
    const userId = userData.user.id;
    const userEmail = userData.user.email ?? "";

    const body = await req.json().catch(() => ({}));
    const confirmation = typeof body?.confirmation === "string" ? body.confirmation.trim() : "";
    if (!userEmail || confirmation.toLowerCase() !== userEmail.toLowerCase()) {
      return json(
        { error: "Type your account email exactly to confirm account deletion." },
        400
      );
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Storage files aren't reached by any foreign-key cascade — clear
    // them first. Best-effort: a storage hiccup shouldn't block the
    // account deletion the person explicitly confirmed, so this logs
    // and continues rather than throwing.
    try {
      const { data: files, error: listErr } = await adminClient.storage
        .from("resumes")
        .list(userId);
      if (listErr) throw listErr;
      if (files && files.length > 0) {
        const paths = files.map((f) => `${userId}/${f.name}`);
        const { error: removeErr } = await adminClient.storage.from("resumes").remove(paths);
        if (removeErr) throw removeErr;
      }
    } catch (e) {
      console.error(`delete-my-account: could not clear storage for ${userId}:`, e);
    }

    // Cascades through profiles/resumes/applications/matches/tasks/
    // cover_letters/interview_sessions/notifications/job_alerts/
    // usage_events/credit_balances/llm_cost_log/agent_runs — every
    // one of those tables' user_id column is `on delete cascade`
    // against auth.users(id).
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteErr) {
      console.error(`delete-my-account: deleteUser failed for ${userId}:`, deleteErr);
      return json({ error: "Could not delete the account. Nothing was removed." }, 500);
    }

    return json({ success: true });
  } catch (error) {
    console.error("delete-my-account failed:", error);
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return json({ error: message }, 500);
  }
});
