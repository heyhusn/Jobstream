// Unified Job Ingestion Service (roadmap M01) — first connector.
//
// Pulls from Greenhouse's public, keyless job-board JSON API — the
// same feed a company's own "embed our openings" widget calls. No
// anti-bot arms race, no ToS exposure, no scraping: this is the
// ingestion posture the roadmap argues for over hitting LinkedIn/
// Indeed/Glassdoor directly (see CLAUDE.md / the roadmap PDF's
// Finding 1).
//
// Scope, on purpose: one source (Greenhouse), a small hardcoded
// board list, no retry/backoff, no source-health table. The
// roadmap's fuller M01 spec (per-source rate limits, exponential
// backoff, a source_health table for the future admin console) is
// real future work — this is the vertical slice that proves the
// shape: fetch -> normalise -> dedupe -> upsert -> close stale
// listings, with one bad board never taking down the others.
//
// Invocation: manual for now (curl / dashboard "Invoke function"),
// same TASK_DISPATCH_SECRET as the other functions via x-task-secret.
// Nothing schedules this automatically yet — no pg_cron wired up in
// this Supabase-only build. Re-run it periodically until that exists.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-task-secret',
};

function checkSecret(req: Request): Response | null {
  const expected = Deno.env.get('TASK_DISPATCH_SECRET');
  if (!expected) {
    console.error('TASK_DISPATCH_SECRET is not set; refusing every request.');
    return new Response(JSON.stringify({ error: 'This function is not configured.' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const got = req.headers.get('x-task-secret') ?? '';
  const enc = new TextEncoder();
  const a = enc.encode(got), b = enc.encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  if (diff !== 0) {
    return new Response(JSON.stringify({ error: 'Not authorised.' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  return null;
}

// Curated, verified-live Greenhouse board tokens. Real companies,
// real public boards — not seed data. `max_jobs` caps how many of
// each board's most-recently-updated postings we take, so one run
// stays fast and doesn't hand generate-matches hundreds of
// un-embedded jobs to catch up on in one call.
const DEFAULT_BOARDS: Array<{
  token: string;
  canonical_name: string;
  domain: string;
  size_band: string;
  hq_country: string;
  max_jobs: number;
}> = [
  { token: 'vercel', canonical_name: 'Vercel', domain: 'vercel.com', size_band: '201-500', hq_country: 'US', max_jobs: 10 },
  { token: 'figma', canonical_name: 'Figma', domain: 'figma.com', size_band: '1001-5000', hq_country: 'US', max_jobs: 10 },
  { token: 'asana', canonical_name: 'Asana', domain: 'asana.com', size_band: '1001-5000', hq_country: 'US', max_jobs: 10 },
  { token: 'brex', canonical_name: 'Brex', domain: 'brex.com', size_band: '501-1000', hq_country: 'US', max_jobs: 10 },
];

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at: string;
  first_published: string | null;
  location: { name: string } | null;
  content?: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferRemoteType(location: string): 'remote' | 'hybrid' | 'onsite' {
  const l = location.toLowerCase();
  if (l.includes('remote')) return 'remote';
  if (l.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

async function ingestBoard(
  supabase: SupabaseClient,
  board: typeof DEFAULT_BOARDS[number],
) {
  const res = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${board.token}/jobs?content=true`,
  );
  if (!res.ok) {
    throw new Error(`Greenhouse ${board.token}: HTTP ${res.status}`);
  }
  const data = await res.json();
  const jobs: GreenhouseJob[] = Array.isArray(data.jobs) ? data.jobs : [];

  const picked = jobs
    .slice()
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, board.max_jobs);

  // Upsert the company once per board, keyed on domain (the
  // existing unique index from 0001_init.sql).
  const { data: company, error: companyErr } = await supabase
    .from('companies')
    .upsert(
      {
        canonical_name: board.canonical_name,
        domain: board.domain,
        ats_type: 'greenhouse',
        size_band: board.size_band,
        hq_country: board.hq_country,
      },
      { onConflict: 'domain' },
    )
    .select('id')
    .single();
  if (companyErr || !company) {
    throw new Error(`Greenhouse ${board.token}: company upsert failed: ${companyErr?.message}`);
  }

  const seenFingerprints: string[] = [];
  let inserted = 0;
  let updated = 0;

  for (const job of picked) {
    const fingerprint = `greenhouse:${board.token}:${job.id}`;
    seenFingerprints.push(fingerprint);

    const location = job.location?.name ?? '';
    const description = job.content ? stripHtml(job.content) : job.title;
    const firstSeenAt = job.first_published ?? job.updated_at;

    // Has this posting been seen before, and if so when did we last
    // see it? Drives the repost heuristic below.
    const { data: existing } = await supabase
      .from('jobs')
      .select('id, last_seen_at, repost_count')
      .eq('fingerprint', fingerprint)
      .maybeSingle();

    // A posting that vanished from the feed for more than 3 days and
    // has now reappeared reads as a relist, not continuous listing —
    // the same signal the ghost-job detector (0007) already scores
    // on. A job seen in every run just has its last_seen_at bumped.
    let repostCount = existing?.repost_count ?? 0;
    if (existing?.last_seen_at) {
      const gapDays = (Date.now() - new Date(existing.last_seen_at).getTime()) / 86_400_000;
      if (gapDays > 3) repostCount += 1;
    }

    const { error: upsertErr } = await supabase.from('jobs').upsert(
      {
        company_id: company.id,
        title: job.title,
        description,
        location,
        remote_type: inferRemoteType(location),
        source: 'greenhouse',
        apply_url: job.absolute_url,
        fingerprint,
        first_seen_at: firstSeenAt,
        last_seen_at: new Date().toISOString(),
        repost_count: repostCount,
        posted_at: firstSeenAt,
        is_active: true,
      },
      { onConflict: 'fingerprint' },
    );
    if (upsertErr) {
      console.error(`Greenhouse ${board.token}: upsert failed for job ${job.id}:`, upsertErr.message);
      continue;
    }
    if (existing) updated += 1; else inserted += 1;
  }

  // Anything for this company we'd previously ingested from this
  // source that didn't show up in this run has been filled or
  // pulled — close it out rather than leaving a stale listing live.
  let closed = 0;
  if (seenFingerprints.length > 0) {
    const { data: closedRows } = await supabase
      .from('jobs')
      .update({ is_active: false })
      .eq('company_id', company.id)
      .eq('source', 'greenhouse')
      .eq('is_active', true)
      .not('fingerprint', 'in', `(${seenFingerprints.map((f) => `"${f}"`).join(',')})`)
      .select('id');
    closed = closedRows?.length ?? 0;
  }

  return { token: board.token, fetched: jobs.length, considered: picked.length, inserted, updated, closed };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const denied = checkSecret(req);
  if (denied) return denied;

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  let boards = DEFAULT_BOARDS;
  try {
    const body = await req.json().catch(() => null);
    if (body?.boards && Array.isArray(body.boards) && body.boards.length > 0) {
      boards = DEFAULT_BOARDS.filter((b) => body.boards.includes(b.token));
    }
  } catch {
    // No body, or not JSON — run the default board list.
  }

  // Isolated per-source failure: one bad board's error is captured
  // and reported, never lets an exception abort the rest of the run.
  const results = await Promise.all(
    boards.map(async (board) => {
      try {
        return await ingestBoard(supabase, board);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Board ${board.token} failed:`, message);
        return { token: board.token, error: message };
      }
    }),
  );

  return new Response(JSON.stringify({ success: true, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
