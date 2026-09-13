-- ═══════════════════════════════════════════════════════════
-- Resume Tailoring Assistant — routes tailor_resume tasks to the new
-- tailor-resume Edge Function. Brand-new task_type (like 0009's
-- resume_optimize and 0013's assisted_apply), not a pre-reserved one
-- (that was 0008's skill_gap situation) — tasks.task_type is a plain
-- `text` column with no check constraint (0001_init.sql), so adding
-- a new type means only "a value this dispatch function has never
-- routed before." Full case list carried forward from 0015 (the most
-- recent migration to touch this function, for agent_run) with one
-- line added, per that migration's own reasoning that Postgres has
-- no "add one branch to an existing CASE" statement.
--
-- Scope reminder (see supabase/functions/tailor-resume/prompt.ts):
-- this rewrites the resume's *existing* bullets to mirror one job's
-- language — it never invents a skill, tool, or achievement the
-- original resume doesn't already state. Complementary to
-- optimize-resume (M10), which only diagnoses gaps and never
-- rewrites anything; this is the "rewrite" half competitors like
-- Teal/Huntr/EarnBetter have that JobSpy didn't.
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
              when 'agent_run'        then 'orchestrate-application'
              when 'tailor_resume'    then 'tailor-resume'
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
