-- Follow-up to 0030: `handle_new_user()`'s referral-code generation
-- only runs on INSERT, so every profile that existed before 0030
-- deployed — both real accounts on this project — was left with
-- `referral_code is null`. Same discipline as 0016 fixing 0015 and
-- 0022 fixing 0020: a follow-up migration, not an edit to the
-- already-applied one.
do $$
declare
  v_profile record;
begin
  for v_profile in select id from public.profiles where referral_code is null loop
    update public.profiles
       set referral_code = public.generate_referral_code()
     where id = v_profile.id;
  end loop;
end;
$$;
