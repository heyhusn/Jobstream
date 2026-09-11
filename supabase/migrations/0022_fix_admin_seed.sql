-- 0020's admin self-provision looked for chairmanhusnain@gmail.com,
-- which doesn't match any account on this project — the real
-- accounts here are mhusnainaslam96@gmail.com and
-- mhusnainaslam2003@gmail.com. Admin was granted directly in
-- production to mhusnainaslam2003@gmail.com (the user's choice); this
-- migration just makes that reproducible on a fresh deploy of this
-- project rather than leaving 0020's seed silently wrong.
insert into private.admin_users (user_id)
select id from auth.users where email = 'mhusnainaslam2003@gmail.com'
on conflict do nothing;
