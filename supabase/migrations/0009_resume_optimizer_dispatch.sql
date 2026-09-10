-- ═══════════════════════════════════════════════════════════
-- Route resume_optimize tasks to the new optimize-resume Edge
-- Function. New task_type (unlike 0008's skill_gap, which had been
-- reserved since 0001), so this is also the first migration that
-- has to add it, not just wire up a missing dispatch case for one
-- that already existed. Same shape as 0008.
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
