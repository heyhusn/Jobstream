-- ═══════════════════════════════════════════════════════════
-- Smart Job Alerts (M16) — scoped honestly for what this app can
-- actually do. There is no scheduler (no pg_cron/Celery Beat, see
-- CLAUDE.md's "Known rough edges") and no email/push infrastructure
-- (M22, Notification/Email Infra, is not started). So this is not a
-- push/email feature: a user saves a named filter over `jobs`, and
-- the client computes how many currently-active jobs match it, and
-- how many are new since the alert was last checked, live — on page
-- load or a "Check now" click. `last_checked_at` is the only piece
-- of state this needs; there is no background job that watches it.
--
-- Plain user-owned data, same posture as `applications` (see
-- 0001_init.sql's "own applications" policy) — not the locked-down,
-- service-role-only posture of `tasks`/`cover_letters`/
-- `interview_sessions`, since nothing here is AI-generated or
-- credit-charged that a client could tamper with.
-- ═══════════════════════════════════════════════════════════

create table public.job_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  -- { remote_type, min_salary, keywords: [...], max_ghost_risk }
  -- Same shape as parse-search-query's SearchFilter, but this table
  -- has no dependency on that function or its edge case fields
  -- (confidence/unsupported) — an alert's filter is authored by hand
  -- via the form on AlertsPage, never parsed from a sentence.
  filter jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index job_alerts_user_idx on public.job_alerts(user_id);

alter table public.job_alerts enable row level security;

-- Full owner CRUD, one policy — same shape as "own applications" /
-- "own profile" in 0001_init.sql. Unlike tasks/cover_letters/
-- interview_sessions, nothing here is written by an Edge Function or
-- needs protecting from the owning user themselves.
create policy "own job alerts" on public.job_alerts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
