-- ═══════════════════════════════════════════════════════════
-- Notification/Email Infra (roadmap M22) — Layer 1: in-app.
--
-- Two honestly-separated layers, per CLAUDE.md's "never fabricate,
-- fail closed" ethos:
--
--   Layer 1 (this migration) — a `notifications` table populated by
--   two real server-side triggers, readable live by the client.
--   Works today, zero configuration, no external dependency.
--
--   Layer 2 (supabase/functions/send-notification) — an email
--   digest sender gated on a RESEND_API_KEY secret that does not
--   exist yet. It is real, working plumbing, but inert (503) until
--   someone adds a Resend account + verified domain + key. See that
--   function's header comment.
--
-- `notifications` follows the same shape as `cover_letters`: the
-- client can read its own rows and flip exactly one column
-- (`read_at`), everything else is written only by triggers or a
-- service-role Edge Function. No insert/delete policy for the
-- client at all — a notification's existence is always the product
-- of something real happening (a task failing, a tracked job's
-- ghost-risk escalating), never something a client can conjure.
-- ═══════════════════════════════════════════════════════════

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('task_failed', 'ghost_risk_escalated')),
  title text not null,
  body text not null,
  link text,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_created_idx
  on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

-- Read your own. No insert/delete policy: every row is written by a
-- trigger function or send-notification, both running as the
-- service role, which bypasses RLS entirely.
drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications
  for select using (auth.uid() = user_id);

-- A client may PATCH its own notification, but the guard trigger
-- below pins every column except read_at back to old.* — this
-- policy only decides *whose* rows the client can attempt to touch,
-- not *which columns* actually move.
drop policy if exists "mark own notifications read" on public.notifications;
create policy "mark own notifications read" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── column-pinning guard, same pattern as guard_cover_letter_update
-- (0005_cover_letters.sql) ───────────────────────────────────────
-- Without this, the update policy above lets a signed-in client
-- PATCH any column it can see — including rewriting `title`/`body`
-- to phish itself, or reassigning `user_id`. Only `read_at` is a
-- fact the client gets to set about its own row; everything else is
-- provenance.
--
-- Service-role writes (the two trigger functions inserting new
-- rows, and send-notification stamping `emailed_at`) must NOT be
-- pinned — this trigger only constrains ordinary client updates, the
-- identical bypass condition as guard_cover_letter_update.
create or replace function public.guard_notification_update()
returns trigger
language plpgsql
as $$
begin
  if current_setting('role', true) = 'service_role'
     or (select rolbypassrls from pg_roles where rolname = current_user) then
    return new;
  end if;

  new.id         := old.id;
  new.user_id    := old.user_id;
  new.type       := old.type;
  new.title      := old.title;
  new.body       := old.body;
  new.link       := old.link;
  new.emailed_at := old.emailed_at;
  new.created_at := old.created_at;
  -- read_at is the one column a client write is allowed to change.

  return new;
end;
$$;

drop trigger if exists notifications_guard_update on public.notifications;
create trigger notifications_guard_update
  before update on public.notifications
  for each row execute function public.guard_notification_update();

-- ── trigger 1: a background task failed ─────────────────────────
-- parse_resume and generate_matches are excluded on purpose: both
-- are onboarding-flow-internal with their own dedicated inline UI
-- feedback (see CLAUDE.md's feature list) — a bell notification for
-- either would just be noise duplicating what's already on-screen.
-- Every other task type is drawer-based, so if the person has since
-- navigated away, this is the only way they find out it failed.
create or replace function public.notify_on_task_failed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  if new.status = 'failed'
     and old.status is distinct from new.status
     and new.task_type not in ('parse_resume', 'generate_matches') then

    -- A bug in here must never fail the task's own legitimate status
    -- write — same reasoning handle_new_task already applies to its
    -- own dispatch failures.
    begin
      v_title := case new.task_type
        when 'cover_letter'    then 'Cover letter'
        when 'skill_gap'       then 'Skill gap analysis'
        when 'resume_optimize' then 'Resume check'
        when 'interview_turn'  then 'Interview prep'
        when 'assisted_apply'  then 'Assisted apply'
        when 'agent_run'       then 'Application assistant'
        else initcap(replace(new.task_type, '_', ' '))
      end;

      insert into public.notifications (user_id, type, title, body, link)
      values (
        new.user_id,
        'task_failed',
        v_title || ' failed',
        coalesce(new.error, 'Something went wrong.'),
        null
      );
    exception when others then
      raise warning 'notify_on_task_failed: could not notify for task %: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_notify_on_failed on public.tasks;
create trigger tasks_notify_on_failed
  after update of status on public.tasks
  for each row execute function public.notify_on_task_failed();

-- ── trigger 2: a tracked job's ghost-risk escalated to high ─────
-- `ghost_signals` is upserted via `insert ... on conflict (job_id)
-- do update` (0007_ghost_job_detector.sql), which Postgres treats as
-- a genuine UPDATE for existing rows, so `after update of risk_band`
-- fires correctly whenever a job's band actually changes.
create or replace function public.notify_on_ghost_risk_escalated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_title text;
  v_user_id   uuid;
begin
  if new.risk_band = 'high' and old.risk_band is distinct from new.risk_band then

    -- Must never be able to break the ghost-signal computation it's
    -- piggybacking on.
    begin
      select title into v_job_title from public.jobs where id = new.job_id;

      for v_user_id in
        select a.user_id
          from public.applications a
         where a.job_id = new.job_id
           and a.stage in ('saved', 'applied', 'interviewing')
      loop
        insert into public.notifications (user_id, type, title, body, link)
        values (
          v_user_id,
          'ghost_risk_escalated',
          'A job you''re tracking now looks higher-risk',
          format('%s — ghost-risk just moved to high.', coalesce(v_job_title, 'A job you''re tracking')),
          null
        );
      end loop;
    exception when others then
      raise warning 'notify_on_ghost_risk_escalated: could not notify trackers of job %: %', new.job_id, sqlerrm;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists ghost_signals_notify_on_escalated on public.ghost_signals;
create trigger ghost_signals_notify_on_escalated
  after update of risk_band on public.ghost_signals
  for each row execute function public.notify_on_ghost_risk_escalated();

-- Trigger functions (return type `trigger`) can't be invoked outside
-- trigger context — PostgREST/.rpc() rejects them outright — so
-- unlike compute_ghost_signal/consume_credit there is nothing here
-- that needs the revoke-from-public / grant-to-service_role
-- treatment from 0006. Same precedent as guard_cover_letter_update
-- and trigger_compute_ghost_signal, neither of which got one either.

-- ── realtime ─────────────────────────────────────────────────────
-- useNotifications.ts subscribes to postgres_changes INSERT events
-- so the bell updates live. Only `tasks` (0001) and `credit_balances`
-- (0006) were ever added to the publication — add this table too.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
