-- ═══════════════════════════════════════════════════════════
-- Currency Conversion (roadmap minor m16) — closes the gap 0012
-- (Salary Intelligence) deliberately left open: "no currency
-- conversion — no FX feed in this codebase." Frankfurter
-- (api.frankfurter.app) is a free, keyless, ECB-backed exchange-rate
-- API, live-verified before this migration was written (a real
-- EUR->USD rate pulled 2026-09-13, historical time series also
-- confirmed working). `sync-fx-rates` (new Edge Function) populates
-- `fx_rates`; nothing here calls out to the network.
--
-- What this deliberately does NOT do, same honesty posture as 0012:
-- Frankfurter only covers ~29 major currencies (the ECB's own
-- reference set) — no PKR, for one, though production data only
-- ever discloses EUR salaries today so this isn't a live gap yet.
-- A currency with no `fx_rates` row gets null `_usd` columns below,
-- never a guessed or stale conversion. This is a nominal exchange-
-- rate conversion, not purchasing-power parity — 0012's own
-- purchasing-power caveat still stands and isn't addressed here.
-- ═══════════════════════════════════════════════════════════

create table public.fx_rates (
  currency text primary key,
  rate_per_usd numeric not null,   -- units of `currency` per 1 USD
  as_of date not null,
  fetched_at timestamptz not null default now()
);

alter table public.fx_rates enable row level security;

-- Exchange rates aren't sensitive — same public-read posture as
-- `jobs`/`companies` and the 0012 views. Only the service-role
-- client in `sync-fx-rates` (which bypasses RLS) may write; no
-- insert/update/delete policy exists for anyone else.
create policy "fx_rates are public read"
  on public.fx_rates for select
  using (true);

grant select on public.fx_rates to anon, authenticated;

-- Re-published with USD-equivalent columns added at the end (adding
-- columns via CREATE OR REPLACE VIEW is safe; the existing ones keep
-- their exact names, types and order for every current consumer).
-- `fx_rate_per_usd` and `fx_as_of` travel with every row so the
-- client can show its own provenance ("converted at the ECB rate as
-- of {date}") instead of presenting a bare converted number.
create or replace view public.salary_market_summary
with (security_invoker = true) as
select
  s.salary_currency,
  s.sample_size,
  s.total_active_in_currency,
  s.min_salary,
  s.max_salary,
  s.avg_salary,
  s.median_salary,
  case
    when s.salary_currency = 'USD' then s.min_salary
    when fx.rate_per_usd is not null then s.min_salary / fx.rate_per_usd
  end as min_salary_usd,
  case
    when s.salary_currency = 'USD' then s.max_salary
    when fx.rate_per_usd is not null then s.max_salary / fx.rate_per_usd
  end as max_salary_usd,
  case
    when s.salary_currency = 'USD' then s.avg_salary
    when fx.rate_per_usd is not null then s.avg_salary / fx.rate_per_usd
  end as avg_salary_usd,
  case
    when s.salary_currency = 'USD' then s.median_salary
    when fx.rate_per_usd is not null then s.median_salary / fx.rate_per_usd
  end as median_salary_usd,
  case when s.salary_currency = 'USD' then 1 else fx.rate_per_usd end as fx_rate_per_usd,
  case when s.salary_currency = 'USD' then null else fx.as_of end as fx_as_of
from (
  select
    salary_currency,
    count(*) filter (where salary_disclosed)                              as sample_size,
    count(*)                                                               as total_active_in_currency,
    min(coalesce(salary_max, salary_min)) filter (where salary_disclosed) as min_salary,
    max(coalesce(salary_max, salary_min)) filter (where salary_disclosed) as max_salary,
    avg(coalesce(salary_max, salary_min)) filter (where salary_disclosed) as avg_salary,
    percentile_cont(0.5)
      within group (order by coalesce(salary_max, salary_min))
      filter (where salary_disclosed)                                     as median_salary
  from public.jobs
  where is_active
  group by salary_currency
  having count(*) filter (where salary_disclosed) >= 1
) s
left join public.fx_rates fx on fx.currency = s.salary_currency;

create or replace view public.company_salary_bands
with (security_invoker = true) as
select
  b.company_id,
  b.salary_currency,
  b.sample_size,
  b.min_salary,
  b.max_salary,
  b.avg_salary,
  case
    when b.salary_currency = 'USD' then b.avg_salary
    when fx.rate_per_usd is not null then b.avg_salary / fx.rate_per_usd
  end as avg_salary_usd,
  case when b.salary_currency = 'USD' then 1 else fx.rate_per_usd end as fx_rate_per_usd,
  case when b.salary_currency = 'USD' then null else fx.as_of end as fx_as_of
from (
  select
    company_id,
    salary_currency,
    count(*)                              as sample_size,
    min(coalesce(salary_max, salary_min)) as min_salary,
    max(coalesce(salary_max, salary_min)) as max_salary,
    avg(coalesce(salary_max, salary_min)) as avg_salary
  from public.jobs
  where is_active and salary_disclosed and company_id is not null
  group by company_id, salary_currency
) b
left join public.fx_rates fx on fx.currency = b.salary_currency;

grant select on public.salary_market_summary to anon, authenticated;
grant select on public.company_salary_bands to anon, authenticated;
