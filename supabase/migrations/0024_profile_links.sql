-- Minor m05: portfolio/GitHub link enrichment on the profile.
-- Two plain nullable text columns — no validation beyond a basic
-- URL-shape check done client-side, same posture as every other
-- free-text profile field (salary_floor, remote_preference, etc.).
-- Existing `profiles` RLS (owner-only select/update) already covers
-- these; no policy changes needed.
alter table public.profiles
  add column if not exists github_url text,
  add column if not exists portfolio_url text;
