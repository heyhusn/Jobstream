-- ═══════════════════════════════════════════════════════════
-- AI Interview Prep Agent (roadmap M13) — the first genuinely
-- multi-turn, stateful feature in this app. Per the roadmap's own
-- classification (Section 6): question selection -> answer
-- evaluation -> adaptive follow-up -> session summary, with durable
-- state across turns. `interview_turn` has been a reserved
-- `task_type` since 0001; this is the first migration to actually
-- give it somewhere to keep that state.
--
-- Deliberately not a LangGraph/agent-framework build (M17, Agent
-- Orchestration Layer, is still not started) — the state machine is
-- small enough (five fixed states: ask, wait-for-answer, evaluate,
-- ask-again-or-summarise, done) that a jsonb column plus a
-- turn_count the Edge Function checks is the honest scope for this
-- app's size, not a framework looking for a reason to exist.
--
-- Guardrail enforced here, not just in a prompt: `max_turns` is a
-- hard cap the Edge Function checks in code before ever asking the
-- model for another question — an agentic loop deciding for itself
-- when to stop is exactly what the roadmap's guardrail section
-- warns against.
-- ═══════════════════════════════════════════════════════════

create table public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  mode text not null check (mode in ('behavioral', 'technical')),
  status text not null default 'active' check (status in ('active', 'completed')),
  -- Array of {question, answer, feedback, score}. `answer` is null
  -- on the current, unanswered turn.
  turns jsonb not null default '[]'::jsonb,
  turn_count int not null default 0,
  max_turns int not null default 5,
  -- Set only once status flips to 'completed':
  -- {overall_feedback, strengths: [...], areas_to_improve: [...]}
  summary jsonb,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index interview_sessions_user_idx
  on public.interview_sessions(user_id, created_at desc);

alter table public.interview_sessions enable row level security;

-- Read-only from the client, same reasoning as cover_letters and
-- tasks: a client that could write its own turns, feedback, or
-- summary could fabricate "you did great" and skip both the real
-- evaluation and the credit charge. Every write goes through the
-- Edge Function under the service role.
create policy "read own interview sessions" on public.interview_sessions
  for select using (auth.uid() = user_id);

create trigger interview_sessions_set_updated_at before update on public.interview_sessions
  for each row execute function public.set_updated_at();

-- ── dispatch ─────────────────────────────────────────────────
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
              else null
            end;

  if v_path is null then
    return new;
  end if;

  select value into v_base   from private.app_config where key = 'functions_url';
  select value into v_anon   from private.app_config where key = 'anon_key';
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
      url     := v_base || v_path,
      headers := v_headers,
      body    := jsonb_build_object('record', row_to_json(new))
    );
  exception when others then
    raise warning 'handle_new_task: dispatch to % failed: %', v_path, sqlerrm;
  end;

  return new;
end;
$$;
