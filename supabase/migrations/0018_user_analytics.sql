-- ═══════════════════════════════════════════════════════════
-- Market Analytics Dashboard (M21) — scoped down hard, on purpose:
-- this is a PERSONAL activity dashboard for the signed-in user, not
-- a global/admin analytics surface. Every view below is a rollup
-- over tables that already exist and are already RLS-scoped to
-- `auth.uid()` (applications, usage_events, matches,
-- interview_sessions) — no new tables, no new writes, no LLM call,
-- no credit charge. A separate, not-yet-built roadmap item (M24
-- Admin Console) covers cross-user/global analytics; nothing here
-- overlaps with it.
--
-- `security_invoker = true` on every view here is not decoration —
-- it's the one thing standing between this feature and a real
-- cross-user data leak. Without it, a view runs with the view
-- OWNER's privileges and bypasses RLS on the tables underneath
-- entirely. Every table these views read from holds a user's own
-- private data (their applications, their credit usage, their
-- matches, their interview sessions), each already protected by an
-- `auth.uid() = user_id` policy (see 0001_init.sql, 0010_interview_
-- prep.sql) — security_invoker is what makes Postgres re-check that
-- policy against whoever is actually running the query, instead of
-- quietly handing back every user's data to whoever asks. Do not
-- drop it from any of these.
--
-- Same house rule as 0011/0012's own header comments: an average or
-- a trend line is only as honest as its sample size, so every
-- aggregate below ships with a count right next to it rather than
-- presenting one or two data points as a confident trend.
-- ═══════════════════════════════════════════════════════════

-- ── my_application_funnel ────────────────────────────────────
-- One row per stage the calling user has any applications in.
-- RLS on `applications` ("own applications", 0001_init.sql) does
-- the per-user scoping — this view adds nothing but the group-by.
create or replace view public.my_application_funnel
with (security_invoker = true) as
select
  stage,
  count(*) as count
from public.applications
group by stage;

-- ── my_credit_usage ──────────────────────────────────────────
-- One row per feature the calling user has ever been charged
-- credits for. RLS on `usage_events` ("own usage") scopes this to
-- the caller automatically.
create or replace view public.my_credit_usage
with (security_invoker = true) as
select
  feature,
  sum(credits_charged) as credits_used,
  count(*) as times_used,
  max(created_at) as last_used_at
from public.usage_events
group by feature
order by sum(credits_charged) desc;

-- ── my_tracked_ghost_exposure ────────────────────────────────
-- Ghost-risk mix across the calling user's own TRACKED jobs (i.e.
-- jobs with a row in `applications`) — not the whole market, that's
-- `company_intelligence`'s job. `applications` is RLS-scoped to the
-- caller; `jobs`/`ghost_signals` are public-read tables ("jobs are
-- public read", "ghost signals are public read"), so the invoker
-- join is safe and correctly scoped by the applications side alone.
--
-- A tracked job with no computed `ghost_signals` row yet (ingested
-- before the trigger ran, or a race with 0007's backfill) gets an
-- honest 'unknown' band instead of being silently dropped from the
-- count or given a fabricated risk level it was never actually
-- scored for.
create or replace view public.my_tracked_ghost_exposure
with (security_invoker = true) as
select
  coalesce(g.risk_band, 'unknown') as band,
  count(*) as count
from public.applications a
join public.jobs j on j.id = a.job_id
left join public.ghost_signals g on g.job_id = j.id
group by coalesce(g.risk_band, 'unknown');

-- ── my_match_score_trend ─────────────────────────────────────
-- The calling user's own matches, bucketed by the day they were
-- computed. `sample_size` rides along on every row on purpose — a
-- day with one match isn't a trend point, it's a data point, and
-- the client is expected to say so rather than plot it as if it
-- carried the same weight as a day with twenty. RLS on `matches`
-- ("own matches") scopes this to the caller.
create or replace view public.my_match_score_trend
with (security_invoker = true) as
select
  date_trunc('day', computed_at) as day,
  avg(score) as avg_score,
  count(*) as sample_size
from public.matches
group by date_trunc('day', computed_at)
order by date_trunc('day', computed_at);

-- ── my_interview_progress ────────────────────────────────────
-- One row per completed interview session, with an average score
-- across that session's turns. `turns` is a jsonb array of
-- {question, answer, feedback, score} (see 0010_interview_prep.sql);
-- a turn's score is only ever populated once the model has actually
-- evaluated an answer, so an in-flight or unanswered turn (score
-- null) is excluded from the average rather than dragging it down
-- toward zero for something that was never scored. RLS on
-- `interview_sessions` ("read own interview sessions") scopes this
-- to the caller; the table is select-only for clients regardless
-- (every write goes through the interview-prep Edge Function under
-- the service role), so there's nothing here for a signed-in user
-- to tamper with.
create or replace view public.my_interview_progress
with (security_invoker = true) as
select
  s.id,
  s.job_id,
  s.mode,
  s.turn_count,
  s.updated_at as completed_at,
  (
    select avg((t ->> 'score')::numeric)
    from jsonb_array_elements(s.turns) as t
    where t ->> 'score' is not null
  ) as avg_score
from public.interview_sessions s
where s.status = 'completed';

-- Granted to `authenticated` only — unlike `company_intelligence`/
-- `salary_market_summary` (public market data, granted to `anon,
-- authenticated` in 0011/0012), everything above is a signed-in
-- user's own private activity, with nothing to show a signed-out
-- visitor and no reason to expose the view to one.
grant select on public.my_application_funnel to authenticated;
grant select on public.my_credit_usage to authenticated;
grant select on public.my_tracked_ghost_exposure to authenticated;
grant select on public.my_match_score_trend to authenticated;
grant select on public.my_interview_progress to authenticated;
