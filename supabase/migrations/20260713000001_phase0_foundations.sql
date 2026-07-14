-- Phase 0 foundations: workspaces + members + RLS baseline.
-- See OUTREACH-BUILD-PLAN.md Section 4. Every future table carries
-- workspace_id and reuses the private.is_workspace_* helpers below.

-- Helper functions live outside `public` so PostgREST never exposes them
-- as RPC endpoints. RLS policies may still call them.
create schema if not exists private;
grant usage on schema private to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  venture text not null check (char_length(venture) between 1 and 60),
  -- CAN-SPAM: printed in every outreach footer for this workspace.
  physical_address text,
  default_timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workspaces is
  'One workspace per venture (FoxStays, Seatop, Octo). All outreach data is isolated per workspace.';

create table public.members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

comment on table public.members is
  'Workspace membership. Owners manage members and settings; members use the platform.';

create index members_user_id_idx on public.members (user_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helpers
-- security definer so policies on `members` can consult `members`
-- without recursing into their own policy.
-- ---------------------------------------------------------------------------

create or replace function private.is_workspace_member(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.workspace_id = ws_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_workspace_owner(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.workspace_id = ws_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.members enable row level security;

create policy "members can view their workspaces"
  on public.workspaces for select
  to authenticated
  using (private.is_workspace_member(id));

create policy "owners can update their workspaces"
  on public.workspaces for update
  to authenticated
  using (private.is_workspace_owner(id))
  with check (private.is_workspace_owner(id));

create policy "owners can delete their workspaces"
  on public.workspaces for delete
  to authenticated
  using (private.is_workspace_owner(id));

-- No insert policy on workspaces: creation goes through create_workspace()
-- so the creator is always installed as owner in the same transaction.

create policy "members can view memberships of their workspaces"
  on public.members for select
  to authenticated
  using (private.is_workspace_member(workspace_id));

create policy "owners can add members"
  on public.members for insert
  to authenticated
  with check (private.is_workspace_owner(workspace_id));

create policy "owners can update members"
  on public.members for update
  to authenticated
  using (private.is_workspace_owner(workspace_id))
  with check (private.is_workspace_owner(workspace_id));

create policy "owners can remove members"
  on public.members for delete
  to authenticated
  using (private.is_workspace_owner(workspace_id));

-- ---------------------------------------------------------------------------
-- Guard: a workspace must never lose its last owner.
-- ---------------------------------------------------------------------------

create or replace function private.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Membership identity is immutable: moving a row to another workspace or
  -- user would let a sole owner slip past the last-owner check below and
  -- leave the old workspace permanently ownerless. Change role only;
  -- add/remove memberships as insert + delete.
  if tg_op = 'UPDATE'
     and (new.workspace_id is distinct from old.workspace_id
          or new.user_id is distinct from old.user_id)
  then
    raise exception 'membership workspace_id/user_id cannot be changed';
  end if;

  -- When the workspace itself is being deleted, member rows arrive here via
  -- FK cascade after the workspace row is already gone: let them through,
  -- otherwise the last-owner check would block every workspace deletion.
  if not exists (
    select 1 from public.workspaces w where w.id = old.workspace_id
  ) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- Same for auth-user deletion (Supabase Auth admin): the cascade may
  -- remove a sole owner. Blocking here would break user deletion outright;
  -- an orphaned workspace can be reassigned via service_role.
  if not exists (
    select 1 from auth.users u where u.id = old.user_id
  ) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- Serialize concurrent member mutations per workspace, otherwise two
  -- simultaneous demotions of a workspace's two owners both pass the
  -- NOT EXISTS below under READ COMMITTED (write skew) and leave zero owners.
  perform 1 from public.workspaces w where w.id = old.workspace_id for update;

  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (
       select 1
       from public.members m
       where m.workspace_id = old.workspace_id
         and m.role = 'owner'
         and m.user_id <> old.user_id
     )
  then
    raise exception 'workspace % must keep at least one owner', old.workspace_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger members_protect_last_owner
  before update or delete on public.members
  for each row execute function private.protect_last_owner();

-- ---------------------------------------------------------------------------
-- RPC: create a workspace and install the caller as its owner.
-- ---------------------------------------------------------------------------

create or replace function public.create_workspace(
  p_name text,
  p_venture text,
  p_physical_address text default null,
  p_default_timezone text default 'America/New_York'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  insert into public.workspaces (name, venture, physical_address, default_timezone)
  values (
    trim(p_name),
    trim(p_venture),
    nullif(trim(p_physical_address), ''),
    coalesce(nullif(trim(p_default_timezone), ''), 'America/New_York')
  )
  returning id into v_workspace_id;

  insert into public.members (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'owner');

  return v_workspace_id;
end;
$$;

revoke execute on function public.create_workspace(text, text, text, text) from public, anon;
grant execute on function public.create_workspace(text, text, text, text) to authenticated;
