-- Minors m07 (saved searches), m17 (exclude-companies blocklist),
-- m18 (negative keyword filters). Three small, independent,
-- user-owned tables — same posture as `job_alerts` (0014): plain
-- owner-CRUD RLS, no service-role involvement, nothing AI-generated
-- or credit-charged.

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  query_text text not null,
  created_at timestamptz not null default now()
);
create index saved_searches_user_idx on public.saved_searches(user_id);

alter table public.saved_searches enable row level security;
create policy "saved searches are owner-only" on public.saved_searches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.company_blocklist (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

alter table public.company_blocklist enable row level security;
create policy "company blocklist is owner-only" on public.company_blocklist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.negative_keywords (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  keyword text not null,
  created_at timestamptz not null default now(),
  unique (user_id, keyword)
);
create index negative_keywords_user_idx on public.negative_keywords(user_id);

alter table public.negative_keywords enable row level security;
create policy "negative keywords are owner-only" on public.negative_keywords
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
