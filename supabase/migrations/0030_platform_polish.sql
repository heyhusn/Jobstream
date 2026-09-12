-- ═══════════════════════════════════════════════════════════
-- Minors m36 (feature flags), m37 (rate limiting), m39 (referral
-- programme), m40 (status page). m32 (demo mode) needed no schema —
-- it's a static, unauthenticated page with hand-written sample data,
-- no Supabase query at all.
-- ═══════════════════════════════════════════════════════════

-- ── m36: feature flags ───────────────────────────────────────
-- Real infra, not a stub with nothing to flip: `search_page_enabled`
-- is seeded on below, defaulting true, so nothing changes for anyone
-- today — but an admin can now flip a feature off for a staged
-- rollback without a deploy, which is the actual point of this
-- roadmap item. Public read (any signed-in user needs to check a
-- flag before rendering); write is gated by `is_admin()`, same
-- boundary as every other admin-only table in this app.
create table public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;

-- Same idiom as "jobs are public read" (0001): the policy allows any
-- row through, and the real restriction is which role gets a GRANT
-- at all — `authenticated` only, not `anon`, since a flag is only
-- ever checked from inside the signed-in app.
create policy "feature flags are readable" on public.feature_flags
  for select using (true);
create policy "feature flags are writable by admins only" on public.feature_flags
  for all using (public.is_admin()) with check (public.is_admin());

-- insert/update/delete are granted too (not just select) so the RLS
-- admin check above is actually reachable — a table-level GRANT is
-- checked before RLS, so without this a real admin's write would be
-- blocked at the grant layer before RLS ever got a say.
grant select, insert, update, delete on public.feature_flags to authenticated;

insert into public.feature_flags (key, enabled, description) values
  ('search_page_enabled', true, 'Shows the hybrid Search nav link and page (M03).')
on conflict (key) do nothing;

-- ── m37: rate limiting ────────────────────────────────────────
-- Real rate limiting is normally an API-gateway concern; this
-- Supabase-only stack has no gateway to put it in, so it's
-- implemented as a Postgres function called from the two Edge
-- Functions that are both (a) JWT-gated but (b) free-tier / not
-- credit-charged, making them the only endpoints in this app someone
-- signed in could hit repeatedly at zero cost: `parse-search-query`
-- and `hybrid-search`. Every other AI feature is already
-- self-limiting via the credit ledger; this closes the one gap that
-- isn't. `rate_limit_events` is a plain append-only log, pruned
-- implicitly by the window check rather than a cleanup job (a
-- pg_cron-based sweep would need the scheduler this app doesn't
-- have — see CLAUDE.md's other "no pg_cron" notes).
create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_events_lookup_idx on public.rate_limit_events(user_id, bucket, created_at desc);

alter table public.rate_limit_events enable row level security;
-- No client access at all, in either direction — only the
-- security-definer function below touches this table.
revoke all on public.rate_limit_events from public, anon, authenticated;

create or replace function public.check_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_limit int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.rate_limit_events
  where user_id = p_user_id
    and bucket = p_bucket
    and created_at > now() - make_interval(secs => p_window_seconds);

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.rate_limit_events (user_id, bucket) values (p_user_id, p_bucket);
  return true;
end;
$$;

revoke all on function public.check_rate_limit(uuid, text, int, int) from public, anon;
grant execute on function public.check_rate_limit(uuid, text, int, int) to authenticated;

-- ── m39: referral programme ───────────────────────────────────
-- Every user gets a code (generated once, at signup, inside the
-- existing `handle_new_user()` trigger — the same server-side
-- bootstrap that already creates the profile/credit-balance rows so
-- the client can never skip or forge it). Reward is granted on the
-- REFERRED user's onboarding completing, not at signup — crediting
-- immediately would trivially pay out for a bare email/password with
-- nobody behind it. `reward_granted` makes the grant idempotent
-- against the trigger firing more than once for the same row.
alter table public.profiles
  add column if not exists referral_code text unique;

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references auth.users(id) on delete cascade,
  referred_id uuid not null unique references auth.users(id) on delete cascade,
  reward_granted boolean not null default false,
  rewarded_at timestamptz,
  created_at timestamptz not null default now()
);
create index referrals_referrer_idx on public.referrals(referrer_id);

alter table public.referrals enable row level security;
create policy "a user can see referrals they made or received"
  on public.referrals for select
  using (auth.uid() = referrer_id or auth.uid() = referred_id);
-- No client insert/update — both happen only via the security-definer
-- triggers below.

insert into private.app_config (key, value) values
  ('referral_bonus_credits', '5')
on conflict (key) do nothing;

create or replace function public.generate_referral_code()
returns text
language plpgsql
as $$
declare
  v_code text;
begin
  loop
    v_code := substr(md5(gen_random_uuid()::text), 1, 8);
    exit when not exists (select 1 from public.profiles where referral_code = v_code);
  end loop;
  return v_code;
end;
$$;

-- Extends the existing new-user bootstrap rather than adding a
-- second trigger on auth.users — one place decides what happens on
-- signup, matching how this function already owns profile + credit
-- balance creation.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_referrer_id uuid;
begin
  insert into public.profiles (id, full_name, referral_code)
  values (new.id, new.raw_user_meta_data ->> 'full_name', public.generate_referral_code());

  insert into public.credit_balances (user_id)
  values (new.id);

  if new.raw_user_meta_data ->> 'referral_code' is not null then
    select id into v_referrer_id
    from public.profiles
    where referral_code = new.raw_user_meta_data ->> 'referral_code';

    if v_referrer_id is not null and v_referrer_id != new.id then
      insert into public.referrals (referrer_id, referred_id)
      values (v_referrer_id, new.id)
      on conflict (referred_id) do nothing;
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Fires when a profile's `onboarded_at` transitions from null to
-- set — the actual "real, engaged signup" signal this programme
-- rewards, not a bare account creation.
create or replace function public.grant_referral_reward()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_referral public.referrals%rowtype;
  v_bonus int;
begin
  if new.onboarded_at is null or old.onboarded_at is not null then
    return new;
  end if;

  select * into v_referral from public.referrals
  where referred_id = new.id and not reward_granted;
  if not found then
    return new;
  end if;

  select value::int into v_bonus from private.app_config where key = 'referral_bonus_credits';
  v_bonus := coalesce(v_bonus, 5);

  update public.credit_balances
     set credits_remaining = credits_remaining + v_bonus
   where user_id = v_referral.referrer_id;

  update public.referrals
     set reward_granted = true, rewarded_at = now()
   where id = v_referral.id;

  return new;
end;
$$;

drop trigger if exists profiles_grant_referral_reward on public.profiles;
create trigger profiles_grant_referral_reward
  after update of onboarded_at on public.profiles
  for each row execute function public.grant_referral_reward();

-- ── m40: status page ──────────────────────────────────────────
-- Single-row table, admin-editable, publicly readable (a status page
-- that requires sign-in to view defeats the point).
create table public.system_status (
  id boolean primary key default true check (id),
  status text not null default 'operational'
    check (status in ('operational', 'degraded', 'outage')),
  message text,
  updated_at timestamptz not null default now()
);
insert into public.system_status (id) values (true) on conflict do nothing;

alter table public.system_status enable row level security;
create policy "system status is public read" on public.system_status
  for select using (true);
create policy "system status is admin-writable" on public.system_status
  for update using (public.is_admin()) with check (public.is_admin());

grant select on public.system_status to anon, authenticated;
grant update on public.system_status to authenticated;
