-- Minors m19 (custom Kanban stages), m22 (interview scheduling notes
-- with timezone conversion), m24 (recruiter/contact notes attached
-- to a company).

-- ── m19: per-user stage preferences ─────────────────────────────
-- Scoped honestly, not a full "arbitrary stages" redesign: the
-- underlying `applications.stage` check constraint (six fixed ids)
-- stays exactly as it is, since `my_application_funnel` (M21) and
-- the Kanban board's own drag-and-drop both key off those six
-- values. What's actually customizable is the presentation layer —
-- rename a column, reorder it, hide one you never use (e.g. someone
-- who never uses "Withdrawn"). A real change to the stage set itself
-- (adding a genuinely new stage) would mean loosening the check
-- constraint and auditing every place that assumes these six values,
-- which is a bigger and riskier change than a minor feature
-- warrants against a board already in production use.
create table public.kanban_stage_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  stage_id text not null
    check (stage_id in ('saved','applied','interviewing','offer','rejected','withdrawn')),
  custom_label text,
  position int,
  hidden boolean not null default false,
  primary key (user_id, stage_id)
);

alter table public.kanban_stage_prefs enable row level security;
create policy "kanban stage prefs are owner-only" on public.kanban_stage_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── m22: interview scheduling with timezone conversion ──────────
-- Plain columns on `applications`, not a separate table — this is
-- one interview slot per application's current stage, same
-- granularity as `next_action_at`. `interview_timezone` is the IANA
-- zone the time was scheduled in (e.g. what a recruiter's email
-- says), stored alongside the instant itself so the client can show
-- "that's 9pm your time" without losing which zone it was quoted in.
alter table public.applications
  add column if not exists interview_at timestamptz,
  add column if not exists interview_timezone text;

-- ── m24: recruiter/contact notes attached to a company ──────────
-- Company-scoped, not application-scoped: the point is "Sarah in
-- recruiting is great, ping her directly next time" persisting
-- across every future application to the same company, not living
-- and dying with one application's notes field.
create table public.company_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_name text,
  note text not null,
  created_at timestamptz not null default now()
);
create index company_contacts_user_company_idx on public.company_contacts(user_id, company_id);

alter table public.company_contacts enable row level security;
create policy "company contacts are owner-only" on public.company_contacts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
