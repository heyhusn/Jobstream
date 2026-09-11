-- ═══════════════════════════════════════════════════════════
-- Assisted Apply (roadmap M15) — routes assisted_apply tasks to the
-- new assisted-apply Edge Function. Like 0009's resume_optimize
-- (and unlike 0008's skill_gap, which had been reserved since
-- 0001), this is a brand-new task_type: no prior migration ever
-- named 'assisted_apply' in the tasks table's check constraint or
-- in this dispatch function, so this migration both adds the case
-- below and is the first thing that lets a row of this type do
-- anything once inserted. Same shape as 0009/0010 — the whole
-- function is replaced because Postgres has no "add one branch to
-- an existing CASE" statement, so the full case list is carried
-- forward from 0010 (the most recent migration to touch this
-- function) with one line added, not dropped.
--
-- `tasks.task_type` is a plain `text` column (see 0001_init.sql) with
-- no check constraint, so "new task_type" here means only "a value
-- this dispatch function has never routed before" — nothing else to
-- alter.
--
-- Scope reminder (see supabase/functions/assisted-apply/prompt.ts):
-- this drafts answers to screening questions the person pastes in
-- from a real ATS form — there is no form-autofill, no browser
-- automation, nothing that touches the ATS itself. The Edge
-- Function's only job is grounded drafting, with an explicit
-- "insufficient_info" escape hatch instead of guessing at anything
-- the resume/profile doesn't actually say.
-- ═══════════════════════════════════════════════════════════

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
