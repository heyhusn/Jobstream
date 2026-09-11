// Notification/Email Infra (roadmap M22) — Layer 2: email digest.
//
// This is real, working Resend integration, not a stub: given a
// RESEND_API_KEY, it will actually send. But no Resend account,
// verified sending domain, or API key exists for this project yet —
// see CLAUDE.md's own note on M22. Until someone adds
// RESEND_API_KEY as a secret on this function, every invocation
// returns 503 "This function is not configured", exactly like every
// other secret-gated function in this codebase (parse-resume,
// generate-cover-letter, ingest-jobs's TASK_DISPATCH_SECRET check) —
// never a silent no-op, never a pretend success.
//
// The `from` address below (notifications@yourdomain.example) is a
// placeholder. A real deployment needs a verified sending domain on
// the Resend account before Resend will accept mail from it — that
// is a manual step, the same category as rotating DEEPSEEK_API_KEY
// documented in DEPLOY.md, not something this function can automate.
//
// Invocation: manual (curl / dashboard "Invoke function" / a future
// scheduler), same TASK_DISPATCH_SECRET-gated shape as ingest-jobs —
// not tied to any single user's task row, so it doesn't go through
// the tasks-table/credit-charging pattern the AI features use.
//
// Logic: find every user with at least one notification that is
// both unread (read_at is null) and not yet emailed (emailed_at is
// null), compose one digest per user, send it, and stamp
// emailed_at on exactly the notifications that digest actually
// covered — so re-running this after a partial failure doesn't
// re-send what already went out, and does retry what didn't.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-task-secret",
};

const RESEND_URL = "https://api.resend.com/emails";
const FROM_ADDRESS = "JobSpy <notifications@yourdomain.example>";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} is not set in this function's environment.`);
  }
  return value;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface PendingNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
}

function buildDigestHtml(items: PendingNotification[]): string {
  const rows = items
    .map(
      (n) =>
        `<li style="margin-bottom:12px;"><strong>${escapeHtml(n.title)}</strong><br/>${escapeHtml(n.body)}</li>`
    )
    .join("");
  return `
    <div style="font-family:sans-serif;color:#161C18;">
      <h2 style="margin-bottom:8px;">You have ${items.length} update${items.length === 1 ? "" : "s"}</h2>
      <ul style="padding-left:18px;margin:0;">${rows}</ul>
    </div>
  `.trim();
}

async function sendDigest(resendKey: string, to: string, items: PendingNotification[]) {
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to,
      subject: `You have ${items.length} update${items.length === 1 ? "" : "s"}`,
      html: buildDigestHtml(items),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend returned ${response.status}: ${detail.slice(0, 500)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Same shared-secret gate as every other manually-invoked function
  // in this codebase (ingest-jobs, assisted-apply, ...).
  const expectedSecret = Deno.env.get("TASK_DISPATCH_SECRET");
  if (!expectedSecret) {
    console.error("TASK_DISPATCH_SECRET is not set; refusing every request.");
    return json({ error: "This function is not configured." }, 503);
  }
  if (!timingSafeEqual(req.headers.get("x-task-secret"), expectedSecret)) {
    return json({ error: "Not authorised." }, 401);
  }

  // The whole point of this function is inert until a real Resend
  // account exists. Fail closed, before any database read — never
  // pretend to send, never silently succeed.
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.error("RESEND_API_KEY is not set; this function is not configured yet.");
    return json({ error: "This function is not configured." }, 503);
  }

  let supabase: SupabaseClient;
  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (error) {
    console.error("send-notification: missing Supabase env:", error);
    return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set." }, 500);
  }

  const { data: pending, error: pendingErr } = await supabase
    .from("notifications")
    .select("id, user_id, title, body")
    .is("read_at", null)
    .is("emailed_at", null);

  if (pendingErr) {
    console.error("send-notification: could not load pending notifications:", pendingErr);
    return json({ error: "Could not load pending notifications." }, 500);
  }

  const byUser = new Map<string, PendingNotification[]>();
  for (const row of (pending ?? []) as PendingNotification[]) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }

  let sent = 0;
  let failed = 0;

  // One user's bad email address or a transient Resend error must
  // never stop the rest of the run — same per-recipient isolation as
  // ingest-jobs's per-board isolation.
  await Promise.all(
    Array.from(byUser.entries()).map(async ([userId, items]) => {
      try {
        const { data: userResult, error: userErr } = await supabase.auth.admin.getUserById(userId);
        const email = userResult?.user?.email;
        if (userErr || !email) {
          throw new Error(userErr?.message ?? "No email on file for this user.");
        }

        await sendDigest(resendKey, email, items);

        const { error: stampErr } = await supabase
          .from("notifications")
          .update({ emailed_at: new Date().toISOString() })
          .in(
            "id",
            items.map((i) => i.id)
          );
        if (stampErr) throw stampErr;

        sent += 1;
      } catch (error) {
        failed += 1;
        console.error(`send-notification: digest for user ${userId} failed:`, error);
      }
    })
  );

  return json({ sent, failed });
});
