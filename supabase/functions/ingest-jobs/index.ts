// Unified Job Ingestion Service (roadmap M01).
//
// Pulls from each ATS's own public, keyless job-board JSON API — the
// same feed a company's own "embed our openings" widget calls. No
// anti-bot arms race, no ToS exposure, no scraping: this is the
// ingestion posture the roadmap argues for over hitting LinkedIn/
// Indeed/Glassdoor directly (see CLAUDE.md / the roadmap PDF's
// Finding 1).
//
// Four connectors now (Greenhouse, Lever, Ashby, SmartRecruiters),
// added after live-testing every endpoint against real company
// boards (see the session log) — each returns a normalised job list
// that feeds one shared upsert/dedupe/close-out pipeline, so a new
// ATS is just a new fetch+normalise function, never a duplicated
// pipeline. Scope, on purpose: small hardcoded board lists per
// source, no retry/backoff, no source_health table — the roadmap's
// fuller M01 spec (per-source rate limits, exponential backoff, an
// admin-visible source_health table) is real future work.
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

type AtsType = 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters';

// Curated, verified-live board tokens — each one hand-checked with a
// real curl/fetch against the ATS's own public API before being added
// here (see the session log for the exact probes run). `max_jobs`
// caps how many of each board's most-recently-updated postings we
// take, so one run stays fast and doesn't hand generate-matches
// hundreds of un-embedded jobs to catch up on in one call.
const DEFAULT_BOARDS: Array<{
  ats_type: AtsType;
  token: string;
  canonical_name: string;
  domain: string;
  size_band: string;
  hq_country: string;
  max_jobs: number;
}> = [
  { ats_type: 'greenhouse', token: 'vercel', canonical_name: 'Vercel', domain: 'vercel.com', size_band: '201-500', hq_country: 'US', max_jobs: 10 },
  { ats_type: 'greenhouse', token: 'figma', canonical_name: 'Figma', domain: 'figma.com', size_band: '1001-5000', hq_country: 'US', max_jobs: 10 },
  { ats_type: 'greenhouse', token: 'asana', canonical_name: 'Asana', domain: 'asana.com', size_band: '1001-5000', hq_country: 'US', max_jobs: 10 },
  { ats_type: 'greenhouse', token: 'brex', canonical_name: 'Brex', domain: 'brex.com', size_band: '501-1000', hq_country: 'US', max_jobs: 10 },
  // Lever — https://api.lever.co/v0/postings/{token}?mode=json, verified live 2026-09-13.
  { ats_type: 'lever', token: 'ro', canonical_name: 'Ro', domain: 'ro.co', size_band: '201-500', hq_country: 'US', max_jobs: 10 },
  { ats_type: 'lever', token: 'ledger', canonical_name: 'Ledger', domain: 'ledger.com', size_band: '501-1000', hq_country: 'FR', max_jobs: 10 },
  // Ashby — https://api.ashbyhq.com/posting-api/job-board/{token}, verified live 2026-09-13.
  { ats_type: 'ashby', token: 'ramp', canonical_name: 'Ramp', domain: 'ramp.com', size_band: '1001-5000', hq_country: 'US', max_jobs: 10 },
  { ats_type: 'ashby', token: 'notion', canonical_name: 'Notion', domain: 'notion.so', size_band: '501-1000', hq_country: 'US', max_jobs: 10 },
  { ats_type: 'ashby', token: 'linear', canonical_name: 'Linear', domain: 'linear.app', size_band: '51-200', hq_country: 'US', max_jobs: 10 },
  // SmartRecruiters — https://api.smartrecruiters.com/v1/companies/{token}/postings,
  // verified live 2026-09-13. Only one confirmed working identifier so far — the
  // platform uses each customer's own internal SmartRecruiters account id, not
  // necessarily their public brand name, so most brand-name guesses (Visa, Bosch,
  // McDonald's, ...) came back empty. Add more once the real identifiers are found.
  { ats_type: 'smartrecruiters', token: 'SmartRecruiters', canonical_name: 'SmartRecruiters', domain: 'smartrecruiters.com', size_band: '501-1000', hq_country: 'US', max_jobs: 10 },
];

type Board = typeof DEFAULT_BOARDS[number];

interface NormalizedJob {
  externalId: string;
  title: string;
  description: string;
  location: string;
  applyUrl: string;
  firstSeenAt: string;
  updatedAt: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
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

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at: string;
  first_published: string | null;
  location: { name: string } | null;
  content?: string;
}

async function fetchGreenhouse(token: string): Promise<NormalizedJob[]> {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
  if (!res.ok) throw new Error(`Greenhouse ${token}: HTTP ${res.status}`);
  const data = await res.json();
  const jobs: GreenhouseJob[] = Array.isArray(data.jobs) ? data.jobs : [];
  return jobs.map((job) => {
    const firstSeenAt = job.first_published ?? job.updated_at;
    return {
      externalId: String(job.id),
      title: job.title,
      description: job.content ? stripHtml(job.content) : job.title,
      location: job.location?.name ?? '',
      applyUrl: job.absolute_url,
      firstSeenAt,
      updatedAt: job.updated_at,
    };
  });
}

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt: number;
  descriptionPlain?: string;
  categories?: { location?: string };
  salaryRange?: { min: number; max: number; currency: string };
}

async function fetchLever(token: string): Promise<NormalizedJob[]> {
  const res = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`);
  if (!res.ok) throw new Error(`Lever ${token}: HTTP ${res.status}`);
  const jobs: LeverJob[] = await res.json();
  return jobs.map((job) => {
    const createdIso = new Date(job.createdAt).toISOString();
    const salary = job.salaryRange;
    const hasSalary = !!salary && salary.min > 0 && salary.max > 0;
    return {
      externalId: job.id,
      title: job.text,
      description: job.descriptionPlain?.trim() || job.text,
      location: job.categories?.location ?? '',
      applyUrl: job.hostedUrl,
      firstSeenAt: createdIso,
      updatedAt: createdIso,
      ...(hasSalary ? { salaryMin: salary!.min, salaryMax: salary!.max, salaryCurrency: salary!.currency } : {}),
    };
  });
}

interface AshbyJob {
  id: string;
  title: string;
  location: string;
  jobUrl: string;
  publishedAt: string;
  descriptionPlain?: string;
  isListed: boolean;
}

async function fetchAshby(token: string): Promise<NormalizedJob[]> {
  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${token}`);
  if (!res.ok) throw new Error(`Ashby ${token}: HTTP ${res.status}`);
  const data = await res.json();
  const jobs: AshbyJob[] = Array.isArray(data.jobs) ? data.jobs : [];
  return jobs
    .filter((job) => job.isListed)
    .map((job) => ({
      externalId: job.id,
      title: job.title,
      description: job.descriptionPlain?.trim() || job.title,
      location: job.location ?? '',
      applyUrl: job.jobUrl,
      firstSeenAt: job.publishedAt,
      updatedAt: job.publishedAt,
    }));
}

interface SmartRecruitersPostingSummary {
  id: string;
  name: string;
  releasedDate: string;
  location?: { fullLocation?: string; remote?: boolean };
}

async function fetchSmartRecruiters(token: string, maxJobs: number): Promise<NormalizedJob[]> {
  const listRes = await fetch(`https://api.smartrecruiters.com/v1/companies/${token}/postings`);
  if (!listRes.ok) throw new Error(`SmartRecruiters ${token}: HTTP ${listRes.status}`);
  const listData = await listRes.json();
  const summaries: SmartRecruitersPostingSummary[] = Array.isArray(listData.content) ? listData.content : [];

  // The list endpoint has no description — only the per-posting detail
  // call does (jobAd.sections). Capped by maxJobs before fetching detail
  // so one run never fires more detail requests than it needs to.
  const picked = summaries
    .slice()
    .sort((a, b) => new Date(b.releasedDate).getTime() - new Date(a.releasedDate).getTime())
    .slice(0, maxJobs);

  const jobs = await Promise.all(
    picked.map(async (summary): Promise<NormalizedJob | null> => {
      const detailRes = await fetch(`https://api.smartrecruiters.com/v1/companies/${token}/postings/${summary.id}`);
      if (!detailRes.ok) {
        console.error(`SmartRecruiters ${token}: detail fetch failed for ${summary.id}: HTTP ${detailRes.status}`);
        return null;
      }
      const detail = await detailRes.json();
      const sections = detail.jobAd?.sections ?? {};
      const description = Object.values(sections)
        .map((section: any) => stripHtml(section?.text ?? ''))
        .filter(Boolean)
        .join('\n\n') || summary.name;
      return {
        externalId: summary.id,
        title: summary.name,
        description,
        location: summary.location?.fullLocation ?? '',
        applyUrl: detail.applyUrl ?? detail.postingUrl ?? '',
        firstSeenAt: summary.releasedDate,
        updatedAt: summary.releasedDate,
      };
    }),
  );
  return jobs.filter((j): j is NormalizedJob => j !== null);
}

async function fetchNormalizedJobs(board: Board): Promise<NormalizedJob[]> {
  switch (board.ats_type) {
    case 'greenhouse': return fetchGreenhouse(board.token);
    case 'lever': return fetchLever(board.token);
    case 'ashby': return fetchAshby(board.token);
    case 'smartrecruiters': return fetchSmartRecruiters(board.token, board.max_jobs);
  }
}

async function ingestBoard(supabase: SupabaseClient, board: Board) {
  const allJobs = await fetchNormalizedJobs(board);

  const picked = allJobs
    .slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, board.max_jobs);

  // Upsert the company once per board, keyed on domain (the
  // existing unique index from 0001_init.sql).
  const { data: company, error: companyErr } = await supabase
    .from('companies')
    .upsert(
      {
        canonical_name: board.canonical_name,
        domain: board.domain,
        ats_type: board.ats_type,
        size_band: board.size_band,
        hq_country: board.hq_country,
      },
      { onConflict: 'domain' },
    )
    .select('id')
    .single();
  if (companyErr || !company) {
    throw new Error(`${board.ats_type} ${board.token}: company upsert failed: ${companyErr?.message}`);
  }

  const seenFingerprints: string[] = [];
  let inserted = 0;
  let updated = 0;

  for (const job of picked) {
    const fingerprint = `${board.ats_type}:${board.token}:${job.externalId}`;
    seenFingerprints.push(fingerprint);

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
        description: job.description,
        location: job.location,
        remote_type: inferRemoteType(job.location),
        source: board.ats_type,
        apply_url: job.applyUrl,
        fingerprint,
        first_seen_at: job.firstSeenAt,
        last_seen_at: new Date().toISOString(),
        repost_count: repostCount,
        posted_at: job.firstSeenAt,
        is_active: true,
        ...(job.salaryMin !== undefined ? { salary_min: job.salaryMin, salary_max: job.salaryMax, salary_currency: job.salaryCurrency } : {}),
      },
      { onConflict: 'fingerprint' },
    );
    if (upsertErr) {
      console.error(`${board.ats_type} ${board.token}: upsert failed for job ${job.externalId}:`, upsertErr.message);
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
      .eq('source', board.ats_type)
      .eq('is_active', true)
      .not('fingerprint', 'in', `(${seenFingerprints.map((f) => `"${f}"`).join(',')})`)
      .select('id');
    closed = closedRows?.length ?? 0;
  }

  return { ats_type: board.ats_type, token: board.token, fetched: allJobs.length, considered: picked.length, inserted, updated, closed };
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
        console.error(`Board ${board.token} (${board.ats_type}) failed:`, message);
        return { ats_type: board.ats_type, token: board.token, error: message };
      }
    }),
  );

  return new Response(JSON.stringify({ success: true, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
