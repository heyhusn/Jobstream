-- Agent Orchestration (roadmap M17)
--
-- A small, durable application-preparation workflow over the agents that
-- already exist: first check the resume against a posting, then draft a
-- cover letter. This is intentionally a fixed, inspectable state machine;
-- it is not an open-ended agent loop. Each child task remains responsible
-- for its own credit charge/refund and can still be viewed independently.

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  current_step text,
  -- [{kind, status, task_id?, error?}]. Only the service role writes this.
  steps jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agent_runs_user_created_idx on public.agent_runs(user_id, created_at desc);
create index agent_runs_job_created_idx on public.agent_runs(job_id, created_at desc);

alter table public.agent_runs enable row level security;

-- The client can inspect a run but cannot fabricate step completion or use
-- the table to skip a charge. The Edge Function owns every write.
create policy "read own agent runs" on public.agent_runs
  for select using (auth.uid() = user_id);

create trigger agent_runs_set_updated_at before update on public.agent_runs
  for each row execute function public.set_updated_at();

-- A child task completing is the only event that advances a run. It sends a
-- tiny, authenticated wake-up request; the function re-reads all state, so
-- pg_net's at-least-once delivery cannot advance a step twice.
create or replace function public.notify_agent_step_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_anon text;
  v_secret text;
  v_headers jsonb;
  v_run_id uuid;
begin
  if old.status is not distinct from new.status
     or new.status not in ('done', 'failed')
     or not (new.input ? 'agent_run_id') then
    return new;
  end if;

  begin
    v_run_id := (new.input ->> 'agent_run_id')::uuid;
  exception when invalid_text_representation then
    return new;
  end;

  select value into v_base from private.app_config where key = 'functions_url';
  select value into v_anon from private.app_config where key = 'anon_key';
  select value into v_secret from private.app_config where key = 'task_dispatch_secret';

  v_base := coalesce(v_base, 'https://wtkmrkhaokrcxvkrfyop.supabase.co/functions/v1/');
  v_anon := coalesce(v_anon, 'sb_publishable_gQprN2Jov1dCxyaVJlJufQ_XcxMaVVM');
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || v_anon
  );

  if v_secret is not null then
    v_headers := v_headers || jsonb_build_object('x-task-secret', v_secret);
  end if;

  begin
    perform net.http_post(
      url := v_base || 'orchestrate-application',
      headers := v_headers,
      body := jsonb_build_object('run_id', v_run_id)
    );
  exception when others then
    raise warning 'notify_agent_step_completed: dispatch failed for %: %', v_run_id, sqlerrm;
  end;

  return new;
end;
$$;

create trigger agent_step_completed after update of status on public.tasks
  for each row execute function public.notify_agent_step_completed();

-- Carry forward every existing route and add the parent `agent_run` task.
create or replace function public.handle_new_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base    text;
  v_anon    text;
  v_secret  text;
  v_path    text;
  v_headers jsonb;
begin
  v_path := case new.task_type
              when 'parse_resume'     then 'parse-resume'
              when 'generate_matches' then 'generate-matches'
              when 'cover_letter'     then 'generate-cover-letter'
              when 'skill_gap'        then 'analyze-skill-gap'
              when 'resume_optimize'  then 'optimize-resume'
              when 'interview_turn'   then 'interview-prep'
              when 'assisted_apply'   then 'assisted-apply'
              when 'agent_run'        then 'orchestrate-application'
              else null
            end;

  if v_path is null then return new; end if;

  select value into v_base   from private.app_config where key = 'functions_url';
  select value into v_anon   from private.app_config where key = 'anon_key';
  select value into v_secret from private.app_config where key = 'task_dispatch_secret';
  v_base := coalesce(v_base, 'https://wtkmrkhaokrcxvkrfyop.supabase.co/functions/v1/');
  v_anon := coalesce(v_anon, 'sb_publishable_gQprN2Jov1dCxyaVJlJufQ_XcxMaVVM');
  v_headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon);
  if v_secret is not null then v_headers := v_headers || jsonb_build_object('x-task-secret', v_secret); end if;

  begin
    perform net.http_post(url := v_base || v_path, headers := v_headers, body := jsonb_build_object('record', row_to_json(new)));
  exception when others then
    raise warning 'handle_new_task: dispatch to % failed: %', v_path, sqlerrm;
  end;
  return new;
end;
$$;
