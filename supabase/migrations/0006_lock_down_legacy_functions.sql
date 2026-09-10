-- ═══════════════════════════════════════════════════════════
-- Closing two holes in the pre-existing task layer.
--
-- 0001 is careful: `tasks` has no update policy, so a client can
-- never write its own task result. 0003 then defined two
-- `security definer` functions that do exactly that, and Postgres
-- grants EXECUTE on new functions to PUBLIC by default — so any
-- signed-in user who learns another user's task UUID can call
-- do_parse_resume(<their task id>) and rewrite that row.
--
-- Verified as an exploit before this migration was written: user A
-- moved user B's task to status='failed'. Since the cover-letter
-- function keys its idempotence off `tasks.status`, that also lets
-- an attacker park someone's generation permanently out of
-- 'queued'.
-- ═══════════════════════════════════════════════════════════

revoke all on function public.do_parse_resume(uuid) from public, anon, authenticated;
revoke all on function public.do_generate_matches(uuid) from public, anon, authenticated;
grant execute on function public.do_parse_resume(uuid) to service_role;
grant execute on function public.do_generate_matches(uuid) to service_role;

-- handle_new_task calls both as the definer, so the dispatcher is
-- unaffected by the revoke above.

-- Same default-grant problem, same fix, for the helper 0005 added.
revoke all on function public.tier_monthly_credits(text) from public, anon, authenticated;
grant execute on function public.tier_monthly_credits(text) to service_role;

-- ── realtime ─────────────────────────────────────────────────
-- useCreditBalance subscribes to postgres_changes on
-- credit_balances, but 0001 only added `tasks` to the publication —
-- so that subscription has never delivered anything and the credit
-- chip only moved when something else happened to invalidate it.
-- Guarded because `add table` errors when the table is already a
-- member, and these migrations are meant to be re-runnable.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'credit_balances'
  ) then
    alter publication supabase_realtime add table public.credit_balances;
  end if;
end;
$$;
