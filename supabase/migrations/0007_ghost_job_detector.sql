-- ═══════════════════════════════════════════════════════════
-- Ghost job detector — deterministic, not an LLM.
--
-- The `ghost_signals` table and its UI (risk band + reasons on
-- every match row) have existed since 0001. Nothing has ever
-- computed a real value; seed.sql hand-wrote two demo rows. This
-- migration adds the actual scoring function plus a trigger so
-- every job gets a signal automatically, and backfills whatever
-- is already in the table.
--
-- Deliberately a plain SQL/plpgsql function, per the roadmap: this
-- is feature-based scoring over columns already on `jobs`, not a
-- model call. No LLM has an opinion here, so there's nothing to
-- prompt-inject, nothing to hallucinate, and nothing to cost money.
--
-- What it can't see yet: application-volume proxies and company
-- hiring velocity need ingestion history this repo doesn't have
-- (no scraper/ATS connector exists — see CLAUDE.md). Those slot in
-- as extra weighted terms once `companies`/`jobs` carry that data;
-- until then this scores on the four signals that are actually
-- populated today.
--
-- Freshness note: this recomputes on INSERT/UPDATE of the relevant
-- job columns, not on a schedule. A job that goes quiet (no new
-- row, no field change) will not have its `days_open` term age up
-- on its own — there's no Celery Beat / pg_cron wired up in this
-- Supabase-only build yet. Call
-- `select public.recompute_all_ghost_signals();` periodically (or
-- from pg_cron, if enabled on the project) until a real scheduler
-- exists.
-- ═══════════════════════════════════════════════════════════

create or replace function public.compute_ghost_signal(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job         public.jobs%rowtype;
  v_days_open   int;
  v_reposts     int;
  v_salary_ok   boolean;
  v_on_company  boolean;
  v_fill_rate   numeric;
  v_score       numeric := 0;
  v_reasons     jsonb := '[]'::jsonb;
  -- Sources that are the employer's own first-party ATS feed
  -- (per the roadmap's ingestion posture). Everything else —
  -- aggregators, board scrapes, unknown — counts as third-party.
  v_first_party_sources text[] := array[
    'greenhouse','lever','ashby','workable','smartrecruiters','recruitee'
  ];
begin
  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    return;
  end if;

  v_days_open  := greatest(0, extract(day from now() - v_job.first_seen_at)::int);
  v_reposts    := coalesce(v_job.repost_count, 0);
  v_salary_ok  := v_job.salary_disclosed;
  v_on_company := v_job.source = any(v_first_party_sources);

  select (enrichment ->> 'fill_rate')::numeric into v_fill_rate
    from public.companies
   where id = v_job.company_id;

  -- Days open
  if v_days_open > 90 then
    v_score := v_score + 25;
    v_reasons := v_reasons || jsonb_build_array(format('Open for %s days — well past typical time-to-fill', v_days_open));
  elsif v_days_open > 45 then
    v_score := v_score + 15;
    v_reasons := v_reasons || jsonb_build_array(format('Open for %s days — longer than most postings stay live', v_days_open));
  elsif v_days_open > 21 then
    v_score := v_score + 5;
    v_reasons := v_reasons || jsonb_build_array(format('Open for %s days', v_days_open));
  else
    v_reasons := v_reasons || jsonb_build_array('Recently posted');
  end if;

  -- Reposting
  if v_reposts >= 5 then
    v_score := v_score + 25;
    v_reasons := v_reasons || jsonb_build_array(format('Relisted %s times', v_reposts));
  elsif v_reposts >= 2 then
    v_score := v_score + 15;
    v_reasons := v_reasons || jsonb_build_array(format('Relisted %s times', v_reposts));
  elsif v_reposts = 1 then
    v_score := v_score + 5;
    v_reasons := v_reasons || jsonb_build_array('Relisted once');
  else
    v_reasons := v_reasons || jsonb_build_array('Never relisted');
  end if;

  -- Salary disclosure
  if not v_salary_ok then
    v_score := v_score + 15;
    v_reasons := v_reasons || jsonb_build_array('Salary not disclosed');
  else
    v_reasons := v_reasons || jsonb_build_array('Salary disclosed');
  end if;

  -- First-party vs. third-party listing
  if not v_on_company then
    v_score := v_score + 20;
    v_reasons := v_reasons || jsonb_build_array('Not listed on the company''s own careers page');
  else
    v_reasons := v_reasons || jsonb_build_array('Listed on the company''s own careers page');
  end if;

  -- Company fill-rate history, when it exists (nothing populates
  -- this yet — reads company.enrichment->>'fill_rate' so it turns
  -- on automatically once something does).
  if v_fill_rate is not null then
    if v_fill_rate < 0.3 then
      v_score := v_score + 15;
      v_reasons := v_reasons || jsonb_build_array('This company rarely fills postings it opens');
    elsif v_fill_rate < 0.6 then
      v_score := v_score + 5;
    end if;
  end if;

  v_score := least(100, greatest(0, v_score));

  insert into public.ghost_signals
    (job_id, days_open, repost_count, salary_disclosed, on_company_site,
     company_fill_rate, risk_score, risk_band, reasons, computed_at)
  values
    (p_job_id, v_days_open, v_reposts, v_salary_ok, v_on_company,
     v_fill_rate, v_score,
     case when v_score >= 60 then 'high' when v_score >= 25 then 'medium' else 'low' end,
     v_reasons, now())
  on conflict (job_id) do update set
    days_open         = excluded.days_open,
    repost_count       = excluded.repost_count,
    salary_disclosed   = excluded.salary_disclosed,
    on_company_site    = excluded.on_company_site,
    company_fill_rate  = excluded.company_fill_rate,
    risk_score         = excluded.risk_score,
    risk_band          = excluded.risk_band,
    reasons            = excluded.reasons,
    computed_at        = now();
end;
$$;

revoke all on function public.compute_ghost_signal(uuid) from public, anon, authenticated;
grant execute on function public.compute_ghost_signal(uuid) to service_role;

create or replace function public.recompute_all_ghost_signals()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_count  int := 0;
begin
  for v_job_id in select id from public.jobs where is_active loop
    perform public.compute_ghost_signal(v_job_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.recompute_all_ghost_signals() from public, anon, authenticated;
grant execute on function public.recompute_all_ghost_signals() to service_role;

-- Trigger: any insert, or an update touching a field the score
-- depends on, recomputes that one job's signal.
create or replace function public.trigger_compute_ghost_signal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.compute_ghost_signal(new.id);
  return new;
end;
$$;

drop trigger if exists jobs_compute_ghost_signal on public.jobs;
create trigger jobs_compute_ghost_signal
  after insert or update of repost_count, salary_min, salary_max, source,
    first_seen_at, company_id, is_active
  on public.jobs
  for each row execute function public.trigger_compute_ghost_signal();

-- Backfill whatever is already in the table (the seeded demo rows
-- included) so this migration leaves the data consistent with the
-- function that now owns it.
select public.recompute_all_ghost_signals();
