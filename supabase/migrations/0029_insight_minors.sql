-- ═══════════════════════════════════════════════════════════
-- Minors m26 (response-rate tracking), m28 (platform benchmark),
-- m29 (interview question bank per company), m30 (skill-demand
-- trendline). Same house rules as 0018's M21 views: security_invoker
-- on everything scoped to the caller (RLS on the underlying table
-- does the real work), a sample size riding along on every
-- aggregate, and no new writes.
--
-- m27 (weekly progress digest) needed no schema — see CLAUDE.md for
-- why it's a pull-based in-app summary rather than a scheduled
-- email: no pg_cron and no email provider key exist in this
-- codebase (same gap M16/M22-Layer-2 already flagged), so "weekly"
-- can only honestly mean "computed fresh whenever you look," same
-- as Smart Job Alerts.
-- ═══════════════════════════════════════════════════════════

-- ── m26: response-rate tracking ──────────────────────────────
-- "Responded" means the employer did something other than silence:
-- interviewing, an offer, or an explicit rejection all count —
-- 'saved' (never applied) is excluded from the denominator entirely,
-- and 'withdrawn' is excluded too since that's the user pulling out,
-- not an employer response either way.
create or replace view public.my_response_rate_by_company
with (security_invoker = true) as
select
  j.company_id,
  c.canonical_name,
  count(*) filter (where a.stage not in ('saved', 'withdrawn')) as applied_count,
  count(*) filter (where a.stage in ('interviewing', 'offer', 'rejected')) as responded_count
from public.applications a
join public.jobs j on j.id = a.job_id
left join public.companies c on c.id = j.company_id
where a.stage not in ('saved', 'withdrawn')
group by j.company_id, c.canonical_name;

create or replace view public.my_response_rate_by_source
with (security_invoker = true) as
select
  j.source,
  count(*) filter (where a.stage not in ('saved', 'withdrawn')) as applied_count,
  count(*) filter (where a.stage in ('interviewing', 'offer', 'rejected')) as responded_count
from public.applications a
join public.jobs j on j.id = a.job_id
where a.stage not in ('saved', 'withdrawn')
group by j.source;

-- Only applications with a resume version actually recorded
-- (`resume_version_id`) can be attributed to one — see minor m23.
create or replace view public.my_response_rate_by_resume_version
with (security_invoker = true) as
select
  a.resume_version_id,
  r.version,
  r.track_name,
  count(*) filter (where a.stage not in ('saved', 'withdrawn')) as applied_count,
  count(*) filter (where a.stage in ('interviewing', 'offer', 'rejected')) as responded_count
from public.applications a
join public.resumes r on r.id = a.resume_version_id
where a.stage not in ('saved', 'withdrawn')
group by a.resume_version_id, r.version, r.track_name;

grant select on public.my_response_rate_by_company to authenticated;
grant select on public.my_response_rate_by_source to authenticated;
grant select on public.my_response_rate_by_resume_version to authenticated;

-- ── m28: platform benchmark ──────────────────────────────────
-- A genuine cross-user aggregate needs to bypass the per-user RLS
-- that `applications` correctly enforces — done here as a `security
-- definer` FUNCTION (not an invoker view, which could only ever see
-- the caller's own rows), same escalation pattern as
-- `compute_ghost_signal`/`extract_job_signals`. The safety property
-- that makes this OK to expose broadly: the function returns exactly
-- two numbers — a median rate and a contributing-user count — and
-- nothing that could identify which user contributed what. That's
-- categorically different from `admin_overview()` (0020), which
-- returns real per-user-identifiable data and is gated behind
-- `is_admin()`; there is no such gate here because there is nothing
-- sensitive in the output.
create or replace function public.platform_response_rate_benchmark()
returns table (median_response_rate numeric, contributing_users bigint)
language sql
stable
security definer
set search_path = public
as $$
  with per_user as (
    select
      user_id,
      count(*) filter (where stage in ('interviewing', 'offer', 'rejected'))::numeric
        / nullif(count(*) filter (where stage not in ('saved', 'withdrawn')), 0) as response_rate
    from public.applications
    group by user_id
    having count(*) filter (where stage not in ('saved', 'withdrawn')) > 0
  )
  select
    percentile_cont(0.5) within group (order by response_rate) as median_response_rate,
    count(*) as contributing_users
  from per_user;
$$;

revoke all on function public.platform_response_rate_benchmark() from public, anon;
grant execute on function public.platform_response_rate_benchmark() to authenticated;

-- ── m29: interview question bank per company ─────────────────
-- Every question the CALLER has personally been asked across their
-- own interview-prep sessions (0010), grouped by which company the
-- underlying job belongs to — grounded in this user's real sessions,
-- not fabricated or pulled from another user's. `turns` is
-- unnested since it's a jsonb array of {question, answer, feedback,
-- score}; only the question and the turn's own score travel through
-- (never another user's data — RLS on `interview_sessions` already
-- scopes the join to the caller before this ever runs).
create or replace view public.my_interview_question_bank
with (security_invoker = true) as
select
  j.company_id,
  c.canonical_name,
  s.job_id,
  s.mode,
  t ->> 'question' as question,
  (t ->> 'score')::numeric as score,
  s.created_at as asked_at
from public.interview_sessions s
join public.jobs j on j.id = s.job_id
left join public.companies c on c.id = j.company_id
cross join lateral jsonb_array_elements(s.turns) as t
where t ->> 'question' is not null;

grant select on public.my_interview_question_bank to authenticated;

-- ── m30: skill-demand trendline ───────────────────────────────
-- How often the CALLER's own profile skills show up in active
-- postings' extracted tech_stack tags (minor m14), bucketed by week.
-- Personalized (reads the caller's own `profiles.parsed->skills`,
-- RLS-protected) joined against public job data (`jobs` is
-- public-read) — safe as a plain invoker view since neither side
-- exposes another user's data. Matching is case-insensitive against
-- m14's fixed tag vocabulary; a profile skill that isn't one of
-- those ~38 recognized tags (e.g. a soft skill, or a tool m14 didn't
-- cover) simply won't appear here — an honest gap, not a silent
-- zero presented as "no demand".
create or replace view public.my_skill_demand_trend
with (security_invoker = true) as
select
  lower(skill) as skill,
  date_trunc('week', j.first_seen_at) as week,
  count(*) as job_count
from public.profiles p
cross join lateral jsonb_array_elements_text(coalesce(p.parsed -> 'skills', '[]'::jsonb)) as skill
join public.jobs j
  on j.is_active
  and exists (
    select 1 from unnest(j.tech_stack) as tag
    where lower(tag) = lower(skill)
  )
where p.id = auth.uid()
group by lower(skill), date_trunc('week', j.first_seen_at);

grant select on public.my_skill_demand_trend to authenticated;
