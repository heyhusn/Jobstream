-- Follow-up to 0030: `grant_referral_reward()` cast
-- `private.app_config`'s value straight to `int` with no guard. That
-- config row is fine today (seeded '5' by 0030, nothing else writes
-- to it), but if it were ever edited to something non-numeric, the
-- cast would throw *inside* the same transaction as the `UPDATE
-- profiles SET onboarded_at = ...` that fired this trigger — which
-- would abort onboarding completion entirely for any referred user,
-- not just fail to pay out their referrer's bonus. A reward
-- side-effect should never be able to block the primary action it's
-- attached to; same "degrade gracefully" posture as
-- `cost_budget_ok()` failing open on missing config. Wrapped in its
-- own sub-transaction (a plpgsql exception block) so any failure in
-- the reward logic is swallowed and logged, and the onboarding
-- update always succeeds.
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

  begin
    select * into v_referral from public.referrals
    where referred_id = new.id and not reward_granted;
    if not found then
      return new;
    end if;

    begin
      select value::int into v_bonus from private.app_config where key = 'referral_bonus_credits';
    exception when others then
      v_bonus := null;
    end;
    v_bonus := coalesce(v_bonus, 5);

    update public.credit_balances
       set credits_remaining = credits_remaining + v_bonus
     where user_id = v_referral.referrer_id;

    update public.referrals
       set reward_granted = true, rewarded_at = now()
     where id = v_referral.id;
  exception when others then
    raise warning 'grant_referral_reward failed for profile %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;
