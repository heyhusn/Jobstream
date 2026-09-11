-- Compliance/Governance (roadmap M25), scoped to the two concrete
-- rights an app this size can actually deliver honestly: export your
-- own data, and delete your own account. SettingsPage.tsx already
-- had a stub naming this exact pair as minor feature m38 — this
-- migration is the "export" half; account deletion is a new Edge
-- Function (supabase/functions/delete-my-account), not a migration,
-- since the real work there is calling the Auth admin API and
-- clearing Storage objects, not a new table.
--
-- Deletion note (read before touching this): every table that
-- carries a `user_id` already references `auth.users(id) on delete
-- cascade` (audited across all migrations through 0019 while writing
-- this one) — deleting the `auth.users` row alone already removes
-- essentially everything a user owns, transactionally, for free.
-- Never add a new user-owned table without that same cascade, or
-- account deletion silently stops being complete.

-- ── export_my_data ───────────────────────────────────────────────
-- Plain SQL, `security invoker` (the default — stated explicitly so
-- nobody "fixes" this into security definer later): every subquery
-- is scoped by `auth.uid()`, and RLS on each underlying table
-- enforces the same boundary independently. No new privilege is
-- granted by this function that the caller didn't already have via
-- direct table reads — this just assembles those same reads into one
-- downloadable object instead of eight separate round trips.
create or replace function public.export_my_data()
returns jsonb
language sql
security invoker
stable
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'resumes', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.resumes r where r.user_id = auth.uid()),
    'applications', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.applications a where a.user_id = auth.uid()),
    'matches', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.matches m where m.user_id = auth.uid()),
    'cover_letters', (select coalesce(jsonb_agg(to_jsonb(cl)), '[]'::jsonb) from public.cover_letters cl where cl.user_id = auth.uid()),
    'interview_sessions', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.interview_sessions s where s.user_id = auth.uid()),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from public.notifications n where n.user_id = auth.uid()),
    'job_alerts', (select coalesce(jsonb_agg(to_jsonb(ja)), '[]'::jsonb) from public.job_alerts ja where ja.user_id = auth.uid()),
    'usage_events', (select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) from public.usage_events u where u.user_id = auth.uid()),
    'llm_cost_log', (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from public.llm_cost_log l where l.user_id = auth.uid()),
    'credit_balance', (select to_jsonb(cb) from public.credit_balances cb where cb.user_id = auth.uid()),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.tasks t where t.user_id = auth.uid())
  );
$$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
