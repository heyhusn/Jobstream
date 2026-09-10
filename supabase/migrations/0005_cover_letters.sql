-- ═══════════════════════════════════════════════════════════
-- Cover letters — the first feature that spends a credit.
--
-- Three things live here:
--   1. private.app_config — where the task dispatcher reads its
--      Edge Function URL and shared secret, so neither is baked
--      into a function body again.
--   2. cover_letters — one current letter per (user, job), with
--      provenance columns the client can't forge.
--   3. consume_credit / refund_credit — the atomic pair that
--      makes credit_balances mean something.
-- ═══════════════════════════════════════════════════════════

-- ── 1. private config ────────────────────────────────────────
-- Not in `public`, and no grants to anon/authenticated: only
-- security-definer functions running as the owner can read it.
create schema if not exists private;

create table if not exists private.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

comment on table private.app_config is
  'Dispatcher config. Seed with:
     insert into private.app_config (key, value) values
       (''functions_url'', ''https://<project-ref>.supabase.co/functions/v1/''),
       (''task_dispatch_secret'', ''<a long random string>'')
     on conflict (key) do update set value = excluded.value, updated_at = now();
   Set the same secret as the TASK_DISPATCH_SECRET Edge Function secret.';

-- ── 2. cover_letters ─────────────────────────────────────────
create table if not exists public.cover_letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  -- Nullable on purpose: a letter outlives the application it was
  -- drafted for. Removing a card from the tracker shouldn't
  -- silently delete writing the person may still want.
  application_id uuid references public.applications(id) on delete set null,
  subject text,
  body text not null,
  tone text not null default 'professional'
    check (tone in ('professional', 'warm', 'direct')),
  notes text,                       -- what the person asked to be worked in
  model text not null,              -- which model wrote it
  prompt_version int not null default 1,
  edited boolean not null default false,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One current letter per job. Regenerating replaces it; the UI
  -- confirms first when the person has edited what's there.
  unique (user_id, job_id)
);

create index if not exists cover_letters_user_idx
  on public.cover_letters(user_id, updated_at desc);

alter table public.cover_letters enable row level security;

-- Read, edit and delete your own. Deliberately no insert policy:
-- rows are written only by the Edge Function under the service
-- role, so a letter's provenance always reflects a real generation.
drop policy if exists "read own cover letters" on public.cover_letters;
create policy "read own cover letters" on public.cover_letters
  for select using (auth.uid() = user_id);
drop policy if exists "edit own cover letters" on public.cover_letters;
create policy "edit own cover letters" on public.cover_letters
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "delete own cover letters" on public.cover_letters;
create policy "delete own cover letters" on public.cover_letters
  for delete using (auth.uid() = user_id);

-- The update policy above lets a client PATCH any column it can
-- see, including `model` and `generated_at`. Pin the provenance
-- columns to their old values so "written by deepseek-chat on the
-- 9th, since edited by you" stays true no matter what the client
-- sends.
create or replace function public.guard_cover_letter_update()
returns trigger
language plpgsql
as $$
begin
  -- Regeneration arrives as the UPDATE leg of the Edge Function's
  -- upsert, under the service role. Pinning provenance there would
  -- freeze `model` and `generated_at` at the first draft's values
  -- and mark every fresh draft "edited by you" — the exact opposite
  -- of what this trigger exists to guarantee. Only client writes
  -- are constrained.
  if current_setting('role', true) = 'service_role'
     or (select rolbypassrls from pg_roles where rolname = current_user) then
    new.updated_at := now();
    return new;
  end if;

  new.id             := old.id;
  new.user_id        := old.user_id;
  new.job_id         := old.job_id;
  new.model          := old.model;
  new.prompt_version := old.prompt_version;
  new.generated_at   := old.generated_at;
  new.tone           := old.tone;
  new.notes          := old.notes;
  -- An application_id the client picks is unchecked against RLS
  -- (foreign keys don't consult policies), so a client could point
  -- its letter at someone else's application row.
  new.application_id := old.application_id;
  new.updated_at     := now();

  -- `edited` is a fact about the text, not a flag the client sets.
  if new.body is distinct from old.body or new.subject is distinct from old.subject then
    new.edited := true;
  else
    new.edited := old.edited;
  end if;

  return new;
end;
$$;

drop trigger if exists cover_letters_guard_update on public.cover_letters;
create trigger cover_letters_guard_update
  before update on public.cover_letters
  for each row execute function public.guard_cover_letter_update();

-- ── 3. credits ───────────────────────────────────────────────
create or replace function public.tier_monthly_credits(p_tier text)
returns numeric
language sql
immutable
as $$
  select case p_tier when 'pro' then 100 else 3 end;
$$;

/*
  Spend one credit, or report that there weren't any.

  The row is locked for the duration, so two tasks racing for the
  last credit can't both win — the second waits, re-reads, and gets
  false. The monthly reset is folded in here rather than run by a
  cron: the balance is only ever wrong between the reset date and
  the next time someone actually tries to spend, and at that moment
  this function fixes it before deciding.
*/
create or replace function public.consume_credit(
  p_user_id uuid,
  p_feature text,
  p_credits numeric default 1
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      public.credit_balances%rowtype;
  v_remaining numeric;
  v_reset    timestamptz;
begin
  -- Without this, a negative amount passes the `v_remaining <
  -- p_credits` test and then *adds* to the balance, and zero buys a
  -- free generation. No caller should ever send either.
  if p_credits is null or p_credits <= 0 then
    raise exception 'consume_credit: p_credits must be a positive number, got %', p_credits;
  end if;

  select * into v_row
    from public.credit_balances
   where user_id = p_user_id
     for update;

  if not found then
    return false;
  end if;

  if v_row.credits_reset_at <= now() then
    v_remaining := public.tier_monthly_credits(v_row.tier);
    v_reset     := date_trunc('month', now()) + interval '1 month';
  else
    v_remaining := v_row.credits_remaining;
    v_reset     := v_row.credits_reset_at;
  end if;

  if v_remaining < p_credits then
    -- Persist the reset even when it didn't buy enough, so the
    -- next call doesn't redo this arithmetic.
    update public.credit_balances
       set credits_remaining = v_remaining,
           credits_reset_at  = v_reset
     where user_id = p_user_id;
    return false;
  end if;

  update public.credit_balances
     set credits_remaining = v_remaining - p_credits,
         credits_reset_at  = v_reset
   where user_id = p_user_id;

  insert into public.usage_events (user_id, feature, credits_charged)
  values (p_user_id, p_feature, p_credits);

  return true;
end;
$$;

/*
  Put a credit back when the work didn't happen — the model errored,
  the response was unusable, the request timed out. Logged as a
  negative usage_event rather than a deletion, so the ledger still
  shows what was attempted.
*/
drop function if exists public.refund_credit(uuid, text, numeric);
create function public.refund_credit(
  p_user_id uuid,
  p_feature text,
  p_credits numeric default 1
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  if p_credits is null or p_credits <= 0 then
    raise exception 'refund_credit: p_credits must be a positive number, got %', p_credits;
  end if;

  -- A refund is a reversal, never a top-up: it cannot exceed what
  -- this feature actually charged this period.
  if p_credits > coalesce((
        select sum(credits_charged)
          from public.usage_events
         where user_id = p_user_id
           and feature in (p_feature, p_feature || '_refund')
           and created_at >= date_trunc('month', now())
      ), 0) then
    raise exception 'refund_credit: refund of % exceeds charges for %', p_credits, p_feature;
  end if;

  update public.credit_balances
     set credits_remaining = credits_remaining + p_credits
   where user_id = p_user_id;

  get diagnostics v_updated = row_count;
  -- No balance row means no refund happened. Saying so lets the
  -- caller report a stranded credit instead of logging a ledger
  -- entry for money that never moved.
  if v_updated = 0 then
    return false;
  end if;

  insert into public.usage_events (user_id, feature, credits_charged)
  values (p_user_id, p_feature || '_refund', -p_credits);

  return true;
end;
$$;

-- These run as the owner. A client that could call refund_credit
-- would have unlimited credits, so nothing but the service role
-- gets to call either of them.
revoke all on function public.consume_credit(uuid, text, numeric) from public, anon, authenticated;
revoke all on function public.refund_credit(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.consume_credit(uuid, text, numeric) to service_role;
grant execute on function public.refund_credit(uuid, text, numeric) to service_role;

-- ── 4. dispatch ──────────────────────────────────────────────
/*
  Same shape as before, with two changes:

  - the target URL comes from private.app_config instead of a
    literal, falling back to the current project so an unseeded
    database keeps working;
  - every dispatch carries x-task-secret. The functions compare it
    against their own TASK_DISPATCH_SECRET; the request body is no
    longer the only thing standing between the public internet and
    a service-role client.
*/
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
              else null
            end;

  -- Task types with nothing to fulfil them stay 'queued' on
  -- purpose: a visibly pending task is honest, a failed one is not.
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

  -- handle_new_task is an AFTER INSERT trigger, so an exception in
  -- here aborts the statement: a missing pg_net, a malformed
  -- functions_url, or an unseeded app_config would stop the user
  -- creating ANY task of any type. A dispatch that can't leave is a
  -- task that sits visibly queued, which is the honest failure.
  begin
    perform net.http_post(
      url     := v_base || v_path,
      headers := v_headers,
      -- The id is the only field the newer functions trust; they
      -- re-read the row themselves. The rest is kept so the existing
      -- parse-resume and generate-matches functions still work.
      body    := jsonb_build_object('record', row_to_json(new))
    );
  exception when others then
    raise warning 'handle_new_task: dispatch to % failed: %', v_path, sqlerrm;
  end;

  return new;
end;
$$;
