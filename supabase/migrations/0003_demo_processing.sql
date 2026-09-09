-- ═══════════════════════════════════════════════════════════
-- Demo processing layer.
--
-- These two functions stand in for M04 (LLM resume parser) and
-- M03 + M05 (hybrid embedding search + explainable scoring) from
-- the roadmap. They're plain SQL heuristics — keyword matching
-- and regex — not the real thing. They exist so the frontend has
-- a working end-to-end loop (upload → parse → confirm → matches)
-- without requiring an LLM API key or a deployed embedding
-- pipeline before a single screen can be tested.
--
-- When the real parser and matcher exist (an Edge Function calling
-- an LLM, or the FastAPI/Celery service from the backend plan),
-- delete this file. Nothing in the frontend needs to change — it
-- only ever talks to the `tasks` table, never to this logic
-- directly.
-- ═══════════════════════════════════════════════════════════

create or replace function public.do_parse_resume(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text;
  v_skills text[];
  v_years numeric;
  v_known_skills text[] := array[
    'python','fastapi','django','flask','postgresql','mysql','sql','redis',
    'celery','react','typescript','javascript','node','vue','graphql',
    'aws','gcp','azure','docker','kubernetes','terraform','ci/cd',
    'machine learning','pytorch','tensorflow','pandas','numpy','spark',
    'airflow','kafka','go','rust','java','c++','c#','ruby','php','swift',
    'android','ios','testing','microservices','rest api'
  ];
  v_skill text;
  v_found text[] := '{}';
begin
  select input->>'extracted_text' into v_text
  from public.tasks where id = p_task_id;

  update public.tasks set status = 'running' where id = p_task_id;

  if v_text is null or length(trim(v_text)) < 20 then
    update public.tasks
    set status = 'failed', error = 'Could not read enough text from that file.'
    where id = p_task_id;
    return;
  end if;

  foreach v_skill in array v_known_skills loop
    if v_text ilike '%' || v_skill || '%' then
      v_found := array_append(v_found, v_skill);
    end if;
  end loop;

  select (regexp_match(v_text, '(\d{1,2})\+?\s*years?'))[1]::numeric
    into v_years;

  update public.tasks
  set status = 'done',
      result = jsonb_build_object(
        'skills', to_jsonb(v_found),
        'years_experience', coalesce(v_years, 0),
        'confidence',
          case when array_length(v_found, 1) >= 3 then 0.7 else 0.4 end,
        'note', 'Heuristic extraction — review every field before saving.'
      )
  where id = p_task_id;
end;
$$;

create or replace function public.do_generate_matches(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_profile record;
  v_job record;
  v_score numeric;
  v_breakdown jsonb;
  v_created int := 0;
  v_skill text;
  v_overlap int;
begin
  select user_id into v_user_id from public.tasks where id = p_task_id;
  update public.tasks set status = 'running' where id = p_task_id;

  select * into v_profile from public.profiles where id = v_user_id;

  if v_profile.parsed is null then
    update public.tasks
    set status = 'failed', error = 'No profile to match against yet — finish onboarding first.'
    where id = p_task_id;
    return;
  end if;

  for v_job in
    select j.*, gs.risk_band
    from public.jobs j
    left join public.ghost_signals gs on gs.job_id = j.id
    where j.is_active = true
  loop
    v_score := 45;
    v_breakdown := '[]'::jsonb;
    v_overlap := 0;

    for v_skill in select jsonb_array_elements_text(coalesce(v_profile.parsed->'skills', '[]'::jsonb)) loop
      if v_job.description ilike '%' || v_skill || '%' or v_job.title ilike '%' || v_skill || '%' then
        v_overlap := v_overlap + 1;
      end if;
    end loop;

    if v_overlap > 0 then
      v_score := v_score + least(v_overlap * 8, 32);
      v_breakdown := v_breakdown || jsonb_build_object(
        'label', v_overlap || ' of your skills appear in this posting',
        'delta', least(v_overlap * 8, 32), 'direction', 'pass');
    end if;

    if v_profile.remote_preference is null
       or v_profile.remote_preference = 'no_preference'
       or v_profile.remote_preference = v_job.remote_type then
      v_score := v_score + 12;
      v_breakdown := v_breakdown || jsonb_build_object(
        'label', 'Work arrangement matches your preference', 'delta', 12, 'direction', 'pass');
    else
      v_score := v_score - 10;
      v_breakdown := v_breakdown || jsonb_build_object(
        'label', 'Not your preferred work arrangement (' || coalesce(v_job.remote_type, 'unspecified') || ')',
        'delta', -10, 'direction', 'fail');
    end if;

    if v_profile.salary_floor is not null and v_job.salary_max is not null then
      if v_job.salary_max >= v_profile.salary_floor then
        v_score := v_score + 10;
        v_breakdown := v_breakdown || jsonb_build_object(
          'label', 'Salary range meets your stated floor', 'delta', 10, 'direction', 'pass');
      else
        v_score := v_score - 15;
        v_breakdown := v_breakdown || jsonb_build_object(
          'label', 'Salary range is below your stated floor', 'delta', -15, 'direction', 'fail');
      end if;
    end if;

    if v_job.risk_band = 'high' then
      v_score := v_score - 20;
      v_breakdown := v_breakdown || jsonb_build_object(
        'label', 'High ghost-risk posting', 'delta', -20, 'direction', 'fail');
    end if;

    v_score := greatest(least(v_score, 99), 5);

    insert into public.matches (user_id, job_id, score, score_breakdown, explanation)
    values (v_user_id, v_job.id, v_score, v_breakdown,
      'Heuristic match — the real version will use embedding similarity, not keyword overlap.')
    on conflict (user_id, job_id) do update
      set score = excluded.score,
          score_breakdown = excluded.score_breakdown,
          computed_at = now();

    v_created := v_created + 1;
  end loop;

  update public.tasks
  set status = 'done', result = jsonb_build_object('matches_created', v_created)
  where id = p_task_id;
end;
$$;

create or replace function public.handle_new_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.task_type = 'parse_resume' then
    perform public.do_parse_resume(new.id);
  elsif new.task_type = 'generate_matches' then
    perform public.do_generate_matches(new.id);
  end if;
  -- Other task types (cover_letter, interview_turn) are left
  -- 'queued' — those screens aren't built yet, and a task with
  -- nothing to fulfil it should sit visibly pending, not fail
  -- silently or fake a result.
  return new;
end;
$$;

drop trigger if exists on_task_created on public.tasks;
create trigger on_task_created
  after insert on public.tasks
  for each row execute function public.handle_new_task();
