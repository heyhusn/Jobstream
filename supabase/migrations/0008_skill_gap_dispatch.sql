-- ═══════════════════════════════════════════════════════════
-- Route skill_gap tasks to the new analyze-skill-gap Edge Function.
--
-- `skill_gap` has been a valid task_type since 0001 (see the
-- comment on public.tasks), and the frontend's TaskType union has
-- carried it since before this migration — but handle_new_task's
-- dispatch switch never had a case for it, so a skill_gap task
-- would insert and then sit on 'queued' forever. Same shape as
-- 0005's dispatch function, just one more branch.
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
