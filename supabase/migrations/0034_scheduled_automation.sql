-- ═══════════════════════════════════════════════════════════
-- Scheduled Automation — closes the last real "no scheduler" gap
-- CLAUDE.md has flagged since M01 (ingest-jobs), M07 (ghost-signal
-- recompute), M09 (sync-fx-rates), and M16 (Smart Job Alerts): every
-- one of those was manual-invocation-only (curl / the Admin
-- Console's buttons), and job_alerts only ever checked itself when a
-- user opened the Alerts page. This is the single feature every
-- "auto job search" competitor (Sonara, Loopcv) leads with — closed
-- here without compromising this app's no-auto-apply stance: it's
-- background *discovery* and *notification*, never submission.
--
-- pg_net is already enabled (handle_new_task has used it since
-- 0005). pg_cron is new — if this statement fails on `db push`
-- because the hosting tier restricts CREATE EXTENSION, enable it
-- once via the Supabase Dashboard -> Database -> Extensions UI, then
-- re-run the migration for the rest of this file.
-- ═══════════════════════════════════════════════════════════

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- ── shared dispatch helper ───────────────────────────────────────
-- Same header-building logic as handle_new_task (0005, most recently
-- carried forward in 0013): functions_url/anon_key/task_dispatch_secret
-- come from private.app_config, with the same project fallback and
-- the same "never let a dispatch failure abort the caller" exception
-- guard. Factored out here so the insert-trigger path and these new
-- cron jobs share one implementation instead of two copies of the
-- same header-building code.
create or replace function private.dispatch_scheduled_function(p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base    text;
  v_anon    text;
  v_secret  text;
  v_headers jsonb;
begin
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
    perform net.http_post(url := v_base || p_path, headers := v_headers, body := '{}'::jsonb);
  exception when others then
    raise warning 'dispatch_scheduled_function(%): %', p_path, sqlerrm;
  end;
end;
$$;

-- Only ever called from cron.schedule's SQL (runs as the cron job
-- owner, not through PostgREST) — same "no execute grant needed for
-- authenticated/anon" reasoning as recompute_all_ghost_signals.
revoke all on function private.dispatch_scheduled_function(text) from public, anon, authenticated;

-- ── job_alert_match notifications ────────────────────────────────
-- Extends the M22 notifications table (0019) with a third type. No
-- RLS/UI change needed: NotificationBell and /notifications already
-- render whatever `type` a row carries via `title`/`body`/`link`.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('task_failed', 'ghost_risk_escalated', 'job_alert_match'));

-- Re-implements useJobAlerts.ts's matchesAlertFilter() in SQL against
-- newly-seen jobs only (first_seen_at > last_checked_at). Deliberately
-- re-implemented rather than shared — same "zero coupling" precedent
-- useJobAlerts.ts's own header comment already sets against
-- parse-search-query's equivalent filter logic. Groups every new
-- match for one alert into a single notification (never one row per
-- job) so a broad alert can't flood the bell.
create or replace function public.check_job_alerts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert       record;
  v_new_count   int;
  v_any_fired   boolean := false;
  v_checked_at  timestamptz := now();
begin
  for v_alert in select * from public.job_alerts loop
    select count(*) into v_new_count
    from public.jobs j
    left join public.companies c on c.id = j.company_id
    left join public.ghost_signals gs on gs.job_id = j.id
    where j.is_active
      and j.first_seen_at > v_alert.last_checked_at
      and (
        v_alert.filter->>'remote_type' is null
        or j.remote_type::text = v_alert.filter->>'remote_type'
      )
      and (
        v_alert.filter->>'min_salary' is null
        or coalesce(j.salary_max, j.salary_min) >= (v_alert.filter->>'min_salary')::numeric
      )
      and (
        v_alert.filter->>'max_ghost_risk' is null
        or gs.risk_band is null
        or (case gs.risk_band when 'low' then 0 when 'medium' then 1 when 'high' then 2 end)
           <= (case v_alert.filter->>'max_ghost_risk' when 'low' then 0 when 'medium' then 1 when 'high' then 2 end)
      )
      and (
        coalesce(jsonb_array_length(v_alert.filter->'keywords'), 0) = 0
        or exists (
          select 1 from jsonb_array_elements_text(v_alert.filter->'keywords') kw
          where (j.title || ' ' || coalesce(j.location, '') || ' ' || coalesce(c.canonical_name, ''))
                ilike '%' || kw || '%'
        )
      );

    if v_new_count > 0 then
      insert into public.notifications (user_id, type, title, body, link)
      values (
        v_alert.user_id,
        'job_alert_match',
        v_new_count || ' new job' || case when v_new_count = 1 then '' else 's' end
          || ' match "' || v_alert.name || '"',
        'Open your alert "' || v_alert.name || '" to see the new matches.',
        '/alerts'
      );
      v_any_fired := true;
    end if;

    update public.job_alerts set last_checked_at = v_checked_at where id = v_alert.id;
  end loop;

  if v_any_fired then
    perform private.dispatch_scheduled_function('send-notification');
  end if;

  return (select count(*) from public.job_alerts);
end;
$$;

revoke all on function public.check_job_alerts() from public, anon, authenticated;
grant execute on function public.check_job_alerts() to service_role;

-- ── the four scheduled jobs ──────────────────────────────────────
-- Times are UTC. Offsets from the top of the hour avoid every cron
-- job waking the database at exactly :00.
select cron.schedule('ingest-jobs-6h',               '0 */6 * * *', $$select private.dispatch_scheduled_function('ingest-jobs')$$);
select cron.schedule('sync-fx-rates-daily',           '30 2 * * *', $$select private.dispatch_scheduled_function('sync-fx-rates')$$);
select cron.schedule('recompute-ghost-signals-daily', '0 3 * * *',  $$select public.recompute_all_ghost_signals()$$);
select cron.schedule('check-job-alerts-hourly',       '15 * * * *', $$select public.check_job_alerts()$$);
