-- Admin Console / source-health monitoring (roadmap M24), scoped to
-- what this app can honestly support at its current size: there is
-- no separate ingestion-run log (ingest-jobs writes straight to
-- `jobs`, nothing records "run #N happened at time T with M errors"),
-- so "source health" here is a proxy derived from `jobs` itself
-- (last_seen_at per company), not a real run history. Said plainly
-- in the function comments below rather than implied.
--
-- Everything here is genuinely global/cross-user data — the opposite
-- of M21's per-user analytics, which relied on `security_invoker`
-- views to let existing per-user RLS do the scoping. There is no RLS
-- policy that could honestly express "let admins see everyone's
-- rows," so this uses `security definer` functions instead, each of
-- which checks `is_admin()` as its very first statement and raises
-- an exception for anyone else. A missed check here is a real
-- cross-user data leak, not a cosmetic bug — every function below
-- must open with that check, no exceptions.

-- ── admin allow-list ─────────────────────────────────────────────
-- Lives in `private`, like `private.app_config` — never exposed
-- through PostgREST regardless of RLS, since the schema itself isn't
-- in the API's exposed-schema list.
create table private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Self-provisions whoever is signed in with this project's own
-- account email, if that account already exists. Matches nothing
-- (harmlessly) if it doesn't yet — add further admins by hand with
-- `insert into private.admin_users (user_id) values ('<uuid>');`.
insert into private.admin_users (user_id)
select id from auth.users where email = 'chairmanhusnain@gmail.com'
on conflict do nothing;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public, private
stable
as $$
  select exists (
    select 1 from private.admin_users where user_id = auth.uid()
  );
$$;

-- Safe to expose to any signed-in user: it only ever answers "are
-- YOU an admin" using auth.uid() internally — there's no parameter
-- to probe someone else's status with.
grant execute on function public.is_admin() to authenticated;

-- ── admin_overview ───────────────────────────────────────────────
-- One-shot snapshot: user count, job/application volume, and today's
-- (UTC) total spend/credit usage across every user — the global
-- counterpart to the per-user numbers M21's `my_credit_usage` shows
-- one person at a time.
create or replace function public.admin_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorised.';
  end if;

  select jsonb_build_object(
    'total_users', (select count(*) from auth.users),
    'total_active_jobs', (select count(*) from public.jobs where is_active),
    'total_applications', (select count(*) from public.applications),
    'unread_notifications', (select count(*) from public.notifications where read_at is null),
    'cost_today_usd', (
      select coalesce(sum(estimated_cost_usd), 0) from public.llm_cost_log
       where created_at >= date_trunc('day', now() at time zone 'utc')
    ),
    'credits_charged_today', (
      select coalesce(sum(credits_charged), 0) from public.usage_events
       where created_at >= date_trunc('day', now() at time zone 'utc')
    ),
    'daily_cost_cap_usd', (
      select value::numeric from private.app_config where key = 'daily_cost_cap_usd'
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_overview() from public, anon, authenticated;
grant execute on function public.admin_overview() to authenticated;
-- Grant to `authenticated` rather than locking to `service_role`, on
-- purpose and unlike llm_cost_log's helpers: this one is meant to be
-- called directly by a signed-in admin's own browser session via
-- `.rpc()`, and the `is_admin()` check inside is what actually gates
-- it — every non-admin caller gets an exception, not data.

-- ── admin_task_health ────────────────────────────────────────────
-- Task volume by type and status over a recent window, so a feature
-- silently failing 100% of the time is visible without reading logs.
create or replace function public.admin_task_health(p_hours int default 24)
returns table (task_type text, status text, count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised.';
  end if;

  return query
    select t.task_type, t.status, count(*)
      from public.tasks t
     where t.created_at >= now() - make_interval(hours => greatest(p_hours, 1))
     group by t.task_type, t.status
     order by t.task_type, t.status;
end;
$$;

revoke all on function public.admin_task_health(int) from public, anon, authenticated;
grant execute on function public.admin_task_health(int) to authenticated;

-- ── admin_source_health ──────────────────────────────────────────
-- A proxy for ingestion health, not a real run log — this repo has
-- no table recording "ingest-jobs ran at time T for board X with Y
-- errors" (see ingest-jobs/index.ts; it writes straight to `jobs`).
-- `last_ingested_at` is really "the most recent last_seen_at among
-- this company's jobs," which only moves when ingest-jobs actually
-- touches that company's postings. Said here instead of implied.
create or replace function public.admin_source_health()
returns table (
  company_id uuid,
  canonical_name text,
  total_jobs bigint,
  active_jobs bigint,
  last_ingested_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised.';
  end if;

  return query
    select
      c.id,
      c.canonical_name,
      count(j.id),
      count(j.id) filter (where j.is_active),
      max(j.last_seen_at)
    from public.companies c
    join public.jobs j on j.company_id = c.id
    group by c.id, c.canonical_name
    order by max(j.last_seen_at) desc nulls last;
end;
$$;

revoke all on function public.admin_source_health() from public, anon, authenticated;
grant execute on function public.admin_source_health() to authenticated;
