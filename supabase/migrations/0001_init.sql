-- ═══════════════════════════════════════════════════════════
-- JobSpy — initial schema
-- Run in the Supabase SQL editor, or `supabase db push` locally.
-- ═══════════════════════════════════════════════════════════

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ── profiles ─────────────────────────────────────────────────
-- One row per auth user. Created by a trigger on signup, never
-- by the client — see handle_new_user() below.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  parsed jsonb,                    -- skills, roles, education, locations
  years_experience numeric,
  work_authorisation text,
  parse_confidence numeric,
  remote_preference text check (remote_preference in ('remote','hybrid','onsite','no_preference')),
  salary_floor numeric,
  salary_currency text default 'USD',
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── resumes ──────────────────────────────────────────────────
create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version int not null default 1,
  storage_path text not null,       -- path in the 'resumes' storage bucket
  file_name text not null,
  extracted_text text,
  parse_report jsonb,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index resumes_user_idx on public.resumes(user_id);

-- ── companies ────────────────────────────────────────────────
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  domain text,
  ats_type text,
  size_band text,
  hq_country text,
  enrichment jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index companies_domain_idx on public.companies(domain) where domain is not null;

-- ── jobs ─────────────────────────────────────────────────────
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  title text not null,
  description text not null,
  location text,
  remote_type text check (remote_type in ('remote','hybrid','onsite')),
  salary_min numeric,
  salary_max numeric,
  salary_currency text default 'USD',
  salary_disclosed boolean generated always as (salary_min is not null) stored,
  source text not null,              -- 'greenhouse' | 'lever' | 'ashby' | ...
  apply_url text not null,
  fingerprint text not null,         -- dedupe key
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  repost_count int not null default 0,
  posted_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index jobs_fingerprint_idx on public.jobs(fingerprint);
create index jobs_company_idx on public.jobs(company_id);
create index jobs_active_idx on public.jobs(is_active) where is_active = true;

-- ── job_embeddings ───────────────────────────────────────────
-- Kept separate from jobs so re-embedding with a new model never
-- rewrites the primary record.
create table public.job_embeddings (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  model_name text not null,
  embedding vector(768),
  created_at timestamptz not null default now()
);
create index job_embeddings_hnsw_idx
  on public.job_embeddings using hnsw (embedding vector_cosine_ops);

-- ── ghost_signals ────────────────────────────────────────────
create table public.ghost_signals (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  days_open int not null default 0,
  repost_count int not null default 0,
  salary_disclosed boolean not null default false,
  on_company_site boolean not null default false,
  company_fill_rate numeric,          -- 0..1, from company_stats
  risk_score numeric not null,        -- 0..100, higher = more likely a ghost
  risk_band text not null check (risk_band in ('low','medium','high')),
  reasons jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);

-- ── matches ──────────────────────────────────────────────────
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  score numeric not null,             -- 0..100
  score_breakdown jsonb not null,     -- [{label, delta, direction}]
  explanation text,
  computed_at timestamptz not null default now(),
  unique (user_id, job_id)
);
create index matches_user_score_idx on public.matches(user_id, score desc);

-- ── applications (tracker) ───────────────────────────────────
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  stage text not null default 'saved'
    check (stage in ('saved','applied','interviewing','offer','rejected','withdrawn')),
  stage_order int not null default 0,      -- for drag-reorder within a column
  resume_version_id uuid references public.resumes(id) on delete set null,
  notes text,
  applied_at timestamptz,
  next_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id)
);
create index applications_user_stage_idx on public.applications(user_id, stage);

-- ── tasks ────────────────────────────────────────────────────
-- The async backbone. Every generation feature (parse, cover
-- letter, skill gap, interview turn) writes a row here and the
-- client subscribes to it via Realtime. Whatever eventually does
-- the work — an Edge Function today, a Celery worker later —
-- only needs to update this row the same way.
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_type text not null,           -- 'parse_resume' | 'cover_letter' | 'skill_gap' | ...
  status text not null default 'queued'
    check (status in ('queued','running','done','failed')),
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_user_idx on public.tasks(user_id, created_at desc);

-- ── usage_events ─────────────────────────────────────────────
-- Billing source of truth, independent of whatever's downstream.
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null,
  credits_charged numeric not null default 1,
  created_at timestamptz not null default now()
);

create table public.credit_balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free','pro')),
  credits_remaining numeric not null default 3,
  credits_reset_at timestamptz not null default (date_trunc('month', now()) + interval '1 month')
);

-- ═══════════════════════════════════════════════════════════
-- Row-level security — every user table, on by default.
-- ═══════════════════════════════════════════════════════════

alter table public.profiles enable row level security;
alter table public.resumes enable row level security;
alter table public.matches enable row level security;
alter table public.applications enable row level security;
alter table public.tasks enable row level security;
alter table public.usage_events enable row level security;
alter table public.credit_balances enable row level security;

-- jobs, companies, job_embeddings, ghost_signals are public read
-- (they're market data, not user data) but never client-writable.
alter table public.jobs enable row level security;
alter table public.companies enable row level security;
alter table public.job_embeddings enable row level security;
alter table public.ghost_signals enable row level security;

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own resumes" on public.resumes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own matches" on public.matches
  for select using (auth.uid() = user_id);

create policy "own applications" on public.applications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Deliberately narrower than "for all": a client that could mark
-- its own task done could write its own cover-letter result and
-- skip both the generation and the credit charge. Only insert and
-- select are open to the authenticated user; status and result are
-- written exclusively by security-definer functions (today) or a
-- service-role worker (once the FastAPI/Celery backend exists).
create policy "read own tasks" on public.tasks
  for select using (auth.uid() = user_id);
create policy "create own tasks" on public.tasks
  for insert with check (auth.uid() = user_id);

create policy "own usage" on public.usage_events
  for select using (auth.uid() = user_id);

create policy "own balance" on public.credit_balances
  for select using (auth.uid() = user_id);

create policy "jobs are public read" on public.jobs
  for select using (true);
create policy "companies are public read" on public.companies
  for select using (true);
create policy "embeddings are public read" on public.job_embeddings
  for select using (true);
create policy "ghost signals are public read" on public.ghost_signals
  for select using (true);

-- ═══════════════════════════════════════════════════════════
-- New-user bootstrap: profile row + starter credit balance,
-- created server-side so the client can never skip or forge it.
-- ═══════════════════════════════════════════════════════════

create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');

  insert into public.credit_balances (user_id)
  values (new.id);

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at maintenance
create function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger applications_set_updated_at before update on public.applications
  for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- Realtime: the frontend subscribes to task rows for the async pattern.
alter publication supabase_realtime add table public.tasks;
