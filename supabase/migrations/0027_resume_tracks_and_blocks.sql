-- Minor m02: per-track resume sets. A plain nullable label on each
-- resume version ("AI/ML", "Backend", "Android", "research" — the
-- roadmap's own examples), not a separate tracks table: the roadmap's
-- "default per search" already maps onto the existing `is_primary`
-- flag (every AI feature that reads a resume already orders by
-- `is_primary desc` — see generate-cover-letter, optimize-resume,
-- interview-prep, assisted-apply). Scoped honestly: switching which
-- track is "default" means switching which resume is primary: this
-- does not give each track its own independent set of computed
-- matches — that would mean generate-matches taking a resume/track
-- argument and this app storing multiple parallel match sets per
-- user, a real change to the core matching pipeline this migration
-- deliberately does not make.
alter table public.resumes
  add column if not exists track_name text;

-- Minor m04: cover letter library with reusable saved blocks — a
-- personal snippet library (a standard closing paragraph, a "why
-- this company" boilerplate) a person can insert into any draft
-- while editing, independent of AI generation. Plain owner-CRUD,
-- same posture as `saved_searches`/`negative_keywords`.
create table public.cover_letter_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  content text not null,
  created_at timestamptz not null default now()
);
create index cover_letter_blocks_user_idx on public.cover_letter_blocks(user_id);

alter table public.cover_letter_blocks enable row level security;
create policy "cover letter blocks are owner-only" on public.cover_letter_blocks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
