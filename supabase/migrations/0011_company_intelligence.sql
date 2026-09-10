-- ═══════════════════════════════════════════════════════════
-- Company Intelligence (M08) — a read-only aggregation view, not
-- a new feature pipeline. Everything it reports already lives on
-- `companies`, `jobs`, and `ghost_signals` (populated by 0007's
-- ghost job detector); this just rolls those up per company so the
-- client can query one row instead of running the aggregation
-- itself on every page load.
--
-- Deliberately a plain view, not a function or materialized view:
-- the underlying tables are small (no scraper/ingestion pipeline
-- exists yet — see CLAUDE.md), there's no expensive join or model
-- call to cache, and a plain view always reflects the latest
-- `ghost_signals` row instead of going stale between refreshes.
-- Revisit as a materialized view (refreshed on a schedule) if the
-- jobs table ever grows enough for this to show up in query plans.
-- ═══════════════════════════════════════════════════════════

create or replace view public.company_intelligence
with (security_invoker = true) as
select
  c.id                                                    as company_id,
  c.canonical_name,
  c.domain,
  c.ats_type,
  c.size_band,
  c.hq_country,

  -- Currently live postings vs. everything ever ingested for this
  -- company. The gap between the two is itself a signal (a company
  -- that's had 40 postings and has 2 open now churns roles fast).
  count(*) filter (where j.is_active)                     as open_roles_count,
  count(*)                                                as total_roles_seen,

  -- Average time-to-fill proxy, over *currently active* postings
  -- only — a closed job's clock stopped, so mixing it in would
  -- understate how long today's open roles have actually been open.
  -- Null (not zero) when nothing is active: zero would read as
  -- "roles fill instantly," which is never what an empty set means.
  avg(extract(day from now() - j.first_seen_at)) filter (where j.is_active)
                                                            as avg_days_open,

  -- Fraction of this company's postings (active or not) that have
  -- been relisted at least once. Null with zero jobs so the client
  -- can tell "no data" apart from "a real 0%".
  case when count(*) > 0
    then count(*) filter (where j.repost_count > 0)::numeric / count(*)
    else null
  end                                                       as repost_rate,

  count(*) filter (where g.risk_band = 'low')              as ghost_low_count,
  count(*) filter (where g.risk_band = 'medium')            as ghost_medium_count,
  count(*) filter (where g.risk_band = 'high')             as ghost_high_count,

  max(j.last_seen_at)                                      as last_ingested_at
from public.companies c
-- Inner join on purpose: a company with zero ingested jobs has
-- nothing to report, and would otherwise show up as a row of nulls
-- that looks like "0 open roles" rather than "no data at all".
join public.jobs j on j.company_id = c.id
left join public.ghost_signals g on g.job_id = j.id
group by c.id, c.canonical_name, c.domain, c.ats_type, c.size_band, c.hq_country;

-- companies/jobs/ghost_signals are already public-read tables (see
-- 0001_init.sql's "jobs are public read" / "companies are public
-- read" / "ghost signals are public read" policies) — this view is
-- just a read-only rollup over data that's already public, so it
-- gets the same posture. security_invoker (above) makes sure that
-- posture is enforced by the underlying tables' own RLS rather than
-- by this view running as its owner.
grant select on public.company_intelligence to anon, authenticated;
