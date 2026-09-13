create table public.board_collaborators (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade not null,
  collaborator_email text not null,
  collaborator_id uuid references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, collaborator_email)
);

alter table public.board_collaborators enable row level security;

-- Owners create/view/delete their own collaborator rows. Owners never
-- flip status themselves (that's the invited user's action below), so
-- plain owner-scoped access is safe for insert/select/delete.
create policy "owner manage collaborators" on public.board_collaborators
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Collaborators can see invites addressed to them, by id (once
-- linked) or by the email on their own JWT. Deliberately reads
-- auth.jwt() rather than querying auth.users directly — the
-- authenticated role has no select grant on that table, so a policy
-- that queried it would fail with "permission denied" on every read
-- this policy is OR'd into (every applications/matches/resumes
-- select), not just this table's own.
create policy "collaborator read own invites" on public.board_collaborators
  for select using (
    collaborator_id = auth.uid() or
    collaborator_email = (auth.jwt() ->> 'email')
  );

-- Collaborators may flip their own pending invite to accepted. The
-- guard trigger below pins every column except collaborator_id and
-- status: without it, a client update has no server-side restriction
-- on which columns it touches beyond the WITH CHECK's own state, and
-- WITH CHECK only inspects the *new* row — it can't compare against
-- the old owner_id. A collaborator could otherwise repoint their own
-- invite's owner_id at an arbitrary victim's user id and self-grant
-- read access to that stranger's applications/matches/resumes. Same
-- pinning pattern as guard_notification_update (0019) and
-- guard_cover_letter_update (0005).
create policy "collaborator accept invite" on public.board_collaborators
  for update using (
    collaborator_email = (auth.jwt() ->> 'email')
    and status = 'pending'
  ) with check (
    status = 'accepted'
  );

create or replace function public.guard_board_collaborator_update()
returns trigger
language plpgsql
as $$
begin
  if current_setting('role', true) = 'service_role'
     or (select rolbypassrls from pg_roles where rolname = current_user) then
    return new;
  end if;

  new.id                 := old.id;
  new.owner_id           := old.owner_id;
  new.collaborator_email := old.collaborator_email;
  new.created_at         := old.created_at;
  new.updated_at         := now();
  -- The accepting user is always themselves, never whatever the
  -- client body happened to send.
  new.collaborator_id    := auth.uid();

  return new;
end;
$$;

drop trigger if exists board_collaborators_guard_update on public.board_collaborators;
create trigger board_collaborators_guard_update
  before update on public.board_collaborators
  for each row execute function public.guard_board_collaborator_update();

-- Now, extend existing tables with collaborator read access
create policy "collaborator read applications" on public.applications
  for select using (
    exists(
      select 1 from public.board_collaborators bc
      where bc.owner_id = applications.user_id
        and bc.collaborator_id = auth.uid()
        and bc.status = 'accepted'
    )
  );

create policy "collaborator read matches" on public.matches
  for select using (
    exists(
      select 1 from public.board_collaborators bc
      where bc.owner_id = matches.user_id
        and bc.collaborator_id = auth.uid()
        and bc.status = 'accepted'
    )
  );

create policy "collaborator read resumes" on public.resumes
  for select using (
    exists(
      select 1 from public.board_collaborators bc
      where bc.owner_id = resumes.user_id
        and bc.collaborator_id = auth.uid()
        and bc.status = 'accepted'
    )
  );
