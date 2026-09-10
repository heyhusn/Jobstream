-- ═══════════════════════════════════════════════════════════
-- Salary Intelligence (M09) — a market-wide salary view, built
-- entirely from `jobs.salary_min`/`salary_max`/`salary_currency`/
-- `salary_disclosed` (the generated column from 0001_init.sql).
-- Plain SQL aggregation, no LLM call and no Edge Function: there's
-- nothing here to prompt-inject, nothing to hallucinate, and
-- nothing to cost money, same reasoning as 0007's ghost detector.
--
-- What the roadmap wanted that this deliberately does NOT build:
--
--   1. Cross-currency purchasing-power adjustment. Converting a
--      PKR figure to a USD-equivalent "real" number requires an FX
--      rate feed and a stance on which basket of goods "purchasing
--      power" means, neither of which this repo has. Rather than
--      publish a number that looks precise but bakes in an
--      unstated assumption, `salary_market_summary` reports one
--      row per currency and leaves them uncombined. The client is
--      expected to say plainly that cross-currency comparison
--      isn't implemented, not paper over it.
--
--   2. Inferring a salary band for undisclosed roles from
--      "comparable" postings. That needs a notion of role
--      similarity or seniority classification — title
--      normalisation doesn't exist yet either (see CLAUDE.md,
--      roadmap minor m13) — so there is no honest way to pick which
--      postings a given undisclosed role is "comparable" to. This
--      migration doesn't try; undisclosed rows are excluded from
--      every min/max/avg/median and only show up in the disclosure-
--      rate denominator (`total_active_in_currency`).
--
-- Every aggregate here ships with `sample_size` right next to it on
-- purpose — this codebase's house style (see prompt.ts files, and
-- 0007's own comments) is to never present a number as more
-- reliable than the data behind it actually is. A currency with one
-- disclosed posting still gets a row; it's on the client to say "1
-- posting" out loud instead of showing a confident-looking median.
-- ═══════════════════════════════════════════════════════════

-- ── salary_market_summary ────────────────────────────────────
-- One row per currency that appears among currently active jobs.
-- `coalesce(salary_max, salary_min)` is the representative figure
-- for a job: when both bounds are disclosed, the ceiling is what
-- postings are usually quoted/searched by; when only a floor is
-- given, that floor is still the only real number the posting
-- offers, so it stands in rather than being dropped.
create or replace view public.salary_market_summary
with (security_invoker = true) as
select
  salary_currency,

  -- Disclosed active jobs in this currency — the population every
  -- aggregate below is actually computed over.
  count(*) filter (where salary_disclosed)                as sample_size,

  -- All active jobs in this currency, disclosed or not, so the
  -- client can compute a disclosure rate (sample_size / this) —
  -- itself a real, honest stat, unlike an inferred band would be.
  count(*)                                                 as total_active_in_currency,

  min(coalesce(salary_max, salary_min)) filter (where salary_disclosed)    as min_salary,
  max(coalesce(salary_max, salary_min)) filter (where salary_disclosed)    as max_salary,
  avg(coalesce(salary_max, salary_min)) filter (where salary_disclosed)    as avg_salary,
  percentile_cont(0.5)
    within group (order by coalesce(salary_max, salary_min))
    filter (where salary_disclosed)                                        as median_salary
from public.jobs
where is_active
group by salary_currency
-- A currency with zero disclosed postings (e.g. every active job in
-- it withheld salary) has nothing to aggregate and would otherwise
-- surface as a row of nulls that looks like "$0", not "no data".
having count(*) filter (where salary_disclosed) >= 1;

-- ── company_salary_bands ─────────────────────────────────────
-- One row per (company, currency) among that company's own
-- disclosed active postings — what a specific employer pays, for a
-- company detail page to show alongside the market-wide summary
-- above. Same representative-figure convention as above. Jobs with
-- no salary disclosed, or no company on file, don't belong to any
-- band and are excluded outright rather than counted as zeroes.
create or replace view public.company_salary_bands
with (security_invoker = true) as
select
  company_id,
  salary_currency,
  count(*)                                    as sample_size,
  min(coalesce(salary_max, salary_min))       as min_salary,
  max(coalesce(salary_max, salary_min))       as max_salary,
  avg(coalesce(salary_max, salary_min))       as avg_salary
from public.jobs
where is_active and salary_disclosed and company_id is not null
group by company_id, salary_currency;
-- No `having sample_size >= 1` needed here: `group by` never
-- produces an empty group, so every row already clears that bar.

-- jobs is already a public-read table (see 0001_init.sql's "jobs
-- are public read" policy) — both views only roll up data that's
-- already public, so they get the same posture. security_invoker
-- (above, on both) makes sure that posture is enforced by `jobs`'
-- own RLS rather than by the view running as its owner.
grant select on public.salary_market_summary to anon, authenticated;
grant select on public.company_salary_bands to anon, authenticated;
