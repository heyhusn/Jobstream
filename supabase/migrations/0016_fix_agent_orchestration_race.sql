-- Fixes a real concurrency bug in 0015's agent orchestration (M17),
-- found in review before any real user had run it (agent_runs had
-- zero rows in production at the time of this fix).
--
-- 0015's design advanced a run by having the completed-child-task
-- trigger POST a "wake up" request to orchestrate-application, which
-- re-read the run's state and decided what to do next. Its own
-- comment claimed "the function re-reads all state, so pg_net's
-- at-least-once delivery cannot advance a step twice" — but
-- re-reading state is not an atomic claim. pg_net retries on
-- timeout (the same fact every other Edge Function in this codebase
-- guards against with a conditional `update ... where status =
-- 'queued'` claim before charging anything), so two overlapping
-- deliveries of the same wake-up could both read a step as
-- 'pending' and both insert a new task for it — two tasks, each
-- independently calling consume_credit, for one logical step. The
-- final `cover_letters` row would look fine either way (upserted
-- twice with the same content), which is exactly what would have
-- made the double charge easy to miss without a concurrency test.
--
-- The fix removes the HTTP hop for advancing a run entirely, rather
-- than trying to bolt a lock onto it. `advance_agent_run` does the
-- whole "is the current step done? what's next?" decision inside one
-- `select ... for update`-guarded transaction, and the trigger now
-- calls it directly instead of posting a webhook to itself — there is
-- no network delivery left to duplicate. A bug inside it must never
-- be able to fail the child task's own legitimate status write, so
-- the trigger still swallows exceptions, exactly as handle_new_task
-- already does for its own dispatch failures.
--
-- Also adds `parent_task_id` so advancing a run no longer needs to
-- search `tasks.input`/`tasks.result` for it (0015's lookup there was
-- dead code for the in-progress case — its own comment said as much
-- — masked by a fallback that happened to always resolve correctly).

alter table public.agent_runs
  add column parent_task_id uuid references public.tasks(id) on delete set null;

create or replace function public.advance_agent_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run          record;
  v_steps        jsonb;
  v_idx          int;
  v_current      jsonb;
  v_child_status text;
  v_child_error  text;
  v_next_idx     int;
  v_task_id      uuid;
  v_input        jsonb;
  v_letter_id    uuid;
  v_fail_message text;
begin
  -- Locks the run row for the rest of this transaction. Concurrent
  -- callers for the same run (there should never really be one, now
  -- that advancing isn't triggered over HTTP — this is defense in
  -- depth, the same posture consume_credit takes) serialize here
  -- instead of racing on stale reads.
  select * into v_run from public.agent_runs where id = p_run_id for update;
  if not found or v_run.status <> 'running' then
    return;
  end if;

  v_steps := coalesce(v_run.steps, '[]'::jsonb);

  select (ord - 1) into v_idx
    from jsonb_array_elements(v_steps) with ordinality as t(elem, ord)
   where elem ->> 'kind' = v_run.current_step
   limit 1;

  if v_idx is null then
    update public.agent_runs
       set status = 'failed', current_step = null, error = 'Run has no current step.'
     where id = p_run_id;
    if v_run.parent_task_id is not null then
      update public.tasks
         set status = 'failed', error = 'Run has no current step.'
       where id = v_run.parent_task_id and status = 'running';
    end if;
    return;
  end if;

  v_current := v_steps -> v_idx;

  -- Already dispatched: has its child task reached a terminal state?
  if v_current ->> 'status' in ('queued', 'running') then
    select status, error into v_child_status, v_child_error
      from public.tasks where id = (v_current ->> 'task_id')::uuid;

    if v_child_status is null or v_child_status not in ('done', 'failed') then
      return; -- still in flight — nothing to advance yet
    end if;

    v_steps := jsonb_set(v_steps, array[v_idx::text, 'status'], to_jsonb(v_child_status));
    if v_child_error is not null then
      v_steps := jsonb_set(v_steps, array[v_idx::text, 'error'], to_jsonb(v_child_error));
    end if;

    if v_child_status = 'failed' then
      v_fail_message := coalesce(v_child_error, 'A preparation step didn''t finish.');
      update public.agent_runs
         set status = 'failed', current_step = null, steps = v_steps, error = v_fail_message
       where id = p_run_id;
      if v_run.parent_task_id is not null then
        update public.tasks
           set status = 'failed', error = v_fail_message
         where id = v_run.parent_task_id and status = 'running';
      end if;
      return;
    end if;

    v_current := v_steps -> v_idx;
  end if;

  -- Not yet started: skip it if it would duplicate work the person
  -- already has (never overwrite an existing cover letter), otherwise
  -- dispatch it exactly like every manually-triggered feature does —
  -- insert a `tasks` row and let the existing handle_new_task trigger
  -- route it to its own Edge Function, which owns its own credit
  -- charge and refund-on-failure.
  if v_current ->> 'status' = 'pending' then
    if v_current ->> 'kind' = 'cover_letter' then
      select id into v_letter_id from public.cover_letters
       where user_id = v_run.user_id and job_id = v_run.job_id;
      if v_letter_id is not null then
        v_steps := jsonb_set(v_steps, array[v_idx::text, 'status'], '"skipped"');
        update public.agent_runs set steps = v_steps where id = p_run_id;
        perform public.advance_agent_run(p_run_id);
        return;
      end if;
    end if;

    v_input := jsonb_build_object('job_id', v_run.job_id, 'agent_run_id', p_run_id);
    if v_current ->> 'kind' = 'cover_letter' then
      v_input := v_input || jsonb_build_object(
        'application_id', v_run.application_id,
        'tone', 'professional'
      );
    end if;

    insert into public.tasks (user_id, task_type, input, status)
      values (v_run.user_id, v_current ->> 'kind', v_input, 'queued')
      returning id into v_task_id;

    v_steps := jsonb_set(v_steps, array[v_idx::text, 'status'], '"queued"');
    v_steps := jsonb_set(v_steps, array[v_idx::text, 'task_id'], to_jsonb(v_task_id::text));
    update public.agent_runs set steps = v_steps where id = p_run_id;
    return;
  end if;

  -- Finished (or skipped): move to the next pending step, or finish
  -- the whole run and reflect that onto the parent task the client
  -- is actually watching.
  if v_current ->> 'status' in ('done', 'skipped') then
    select (ord - 1) into v_next_idx
      from jsonb_array_elements(v_steps) with ordinality as t(elem, ord)
     where elem ->> 'status' = 'pending'
     order by ord
     limit 1;

    if v_next_idx is null then
      update public.agent_runs
         set status = 'completed', current_step = null, steps = v_steps, error = null
       where id = p_run_id;
      if v_run.parent_task_id is not null then
        update public.tasks
           set status = 'done', result = jsonb_build_object('run_id', p_run_id, 'steps', v_steps)
         where id = v_run.parent_task_id and status = 'running';
      end if;
      return;
    end if;

    update public.agent_runs
       set current_step = v_steps -> v_next_idx ->> 'kind', steps = v_steps
     where id = p_run_id;
    perform public.advance_agent_run(p_run_id);
  end if;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default —
-- the exact hole 0006 closed for do_parse_resume/do_generate_matches.
-- This function trusts p_run_id fully (it derives user_id from the
-- run row, not from the caller), so an authenticated user calling it
-- directly with a learned run id could force another user's credits
-- to be spent against their own job. Only the service role (via the
-- Edge Function) and this migration's own trigger — which runs as
-- the trigger function's definer, not as PUBLIC — may call it.
revoke all on function public.advance_agent_run(uuid) from public, anon, authenticated;
grant execute on function public.advance_agent_run(uuid) to service_role;

create or replace function public.notify_agent_step_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
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

  -- Advance in-process rather than over HTTP — see this migration's
  -- header comment for why the old design's webhook could double-
  -- dispatch a step. Swallowed on failure for the same reason
  -- handle_new_task swallows its own dispatch failures: a bug in
  -- advancing the pipeline must never fail the child task's own
  -- legitimate, already-correct status write.
  begin
    perform public.advance_agent_run(v_run_id);
  exception when others then
    raise warning 'notify_agent_step_completed: advance failed for %: %', v_run_id, sqlerrm;
  end;

  return new;
end;
$$;
