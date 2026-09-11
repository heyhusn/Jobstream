-- AI Cost Guardrails (roadmap M20), scoped to what this app can
-- honestly claim: there is no second model to route to (DeepSeek is
-- the only provider anywhere in this codebase), so "Model Router" is
-- out of scope the same way Stripe is out of scope elsewhere — this
-- is a real spend cap and real per-call cost logging, not a router.
--
-- Every one of the six DeepSeek-calling Edge Functions
-- (generate-cover-letter, parse-resume, analyze-skill-gap,
-- optimize-resume, interview-prep, assisted-apply) currently has no
-- idea what it costs, and nothing anywhere protects the operator
-- from a bug or a traffic spike running up a real DeepSeek bill —
-- `credit_balances` protects against one user overusing *their own*
-- allowance, not against the whole app's total spend. This closes
-- that gap with two pieces:
--
-- 1. `llm_cost_log` — one row per real DeepSeek HTTP response
--    received (not per task: a retried attempt is a second real,
--    billable call, and is logged as its own row), storing the raw
--    token counts DeepSeek's own response reports and a derived
--    estimated cost. The token counts are ground truth. The dollar
--    figure is explicitly an estimate, using a flat per-million-token
--    rate the operator sets in `private.app_config` — it does not
--    model DeepSeek's cache-hit discount tiers, which aren't visible
--    from the token counts alone, so treat it as directionally
--    correct, not an invoice.
--
-- 2. `cost_budget_ok()` — checked before every credit charge (and,
--    for parse-resume, before its one free-tier DeepSeek call, since
--    that one isn't credit-gated at all but still costs real money).
--    Compares today's (UTC) total estimated cost against
--    `daily_cost_cap_usd` in `private.app_config`. If the cap is
--    missing or unreadable, this fails OPEN (returns true) rather
--    than taking every AI feature down over a missing config row —
--    the same "degrade gracefully on missing operator config"
--    posture `handle_new_task` already takes when secrets are unset.
--    A sensible default cap is seeded below so that gap shouldn't
--    normally exist in practice.

insert into private.app_config (key, value) values
  ('daily_cost_cap_usd', '5.00'),
  ('deepseek_usd_per_million_tokens', '1.00')
on conflict (key) do nothing;

create table public.llm_cost_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  feature text not null,
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index llm_cost_log_created_idx on public.llm_cost_log(created_at desc);
create index llm_cost_log_user_created_idx on public.llm_cost_log(user_id, created_at desc);

alter table public.llm_cost_log enable row level security;

-- Read-only for the client, same posture as `tasks`/`usage_events` —
-- every row is written by a service-role Edge Function, never by the
-- person whose usage it records.
create policy "read own llm cost log" on public.llm_cost_log
  for select using (auth.uid() = user_id);

create or replace function public.cost_budget_ok()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap   numeric;
  v_spent numeric;
begin
  begin
    select value::numeric into v_cap from private.app_config where key = 'daily_cost_cap_usd';
  exception when others then
    v_cap := null;
  end;

  if v_cap is null then
    -- No cap configured (or it isn't a valid number) — degrade
    -- gracefully rather than blocking every AI feature over an
    -- operator config gap.
    return true;
  end if;

  select coalesce(sum(estimated_cost_usd), 0) into v_spent
    from public.llm_cost_log
   where created_at >= date_trunc('day', now() at time zone 'utc');

  return v_spent < v_cap;
end;
$$;

revoke all on function public.cost_budget_ok() from public, anon, authenticated;
grant execute on function public.cost_budget_ok() to service_role;

create or replace function public.log_llm_usage(
  p_user_id uuid,
  p_task_id uuid,
  p_feature text,
  p_prompt_tokens int,
  p_completion_tokens int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate numeric;
  v_cost numeric;
begin
  begin
    select value::numeric into v_rate from private.app_config where key = 'deepseek_usd_per_million_tokens';
  exception when others then
    v_rate := null;
  end;
  v_rate := coalesce(v_rate, 1.00);

  v_cost := (coalesce(p_prompt_tokens, 0) + coalesce(p_completion_tokens, 0)) * v_rate / 1000000.0;

  insert into public.llm_cost_log (user_id, task_id, feature, prompt_tokens, completion_tokens, estimated_cost_usd)
  values (p_user_id, p_task_id, p_feature, coalesce(p_prompt_tokens, 0), coalesce(p_completion_tokens, 0), v_cost);
end;
$$;

revoke all on function public.log_llm_usage(uuid, uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.log_llm_usage(uuid, uuid, text, int, int) to service_role;
