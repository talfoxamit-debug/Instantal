-- Roadmap P2b: LinkedIn as a first-class outreach channel alongside email,
-- dispatched through Unipile (a unified messaging API — LinkedIn has no official
-- automation API). Design goals:
--   * a campaign step declares its channel ('email' | 'linkedin'); the sequence
--     engine and unified inbox treat both uniformly;
--   * LinkedIn sends run on their OWN worker with per-account throttling
--     (invites/day, messages/day) — LinkedIn restricts aggressive automation,
--     so conservative pacing is a correctness requirement, not a nicety;
--   * inbound LinkedIn messages land in the SAME replies table (channel column)
--     so the existing unified inbox + Claude classifier work unchanged.

-- ---------------------------------------------------------------------------
-- Connected LinkedIn accounts (one Unipile-connected account per sender)
-- ---------------------------------------------------------------------------
create table public.linkedin_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Unipile's account id + DSN (account-specific API subdomain).
  unipile_account_id text,
  unipile_dsn text,
  name text,                          -- the LinkedIn profile name, for display
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'error', 'disconnected')),
  -- Conservative default caps (LinkedIn-safe). Operator-tunable.
  daily_invite_cap integer not null default 20 check (daily_invite_cap between 0 and 100),
  daily_message_cap integer not null default 40 check (daily_message_cap between 0 and 200),
  last_invite_at timestamptz,
  last_message_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, unipile_account_id)
);

create index linkedin_accounts_workspace_idx
  on public.linkedin_accounts (workspace_id);

create trigger linkedin_accounts_set_updated_at
  before update on public.linkedin_accounts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Channel on steps + queue + records
-- ---------------------------------------------------------------------------

-- A step is email (subject/body) or a LinkedIn action.
alter table public.campaign_steps
  add column if not exists channel text not null default 'email'
    check (channel in ('email', 'linkedin')),
  add column if not exists linkedin_action text
    check (linkedin_action is null or linkedin_action in ('connect', 'message', 'inmail'));

-- A campaign picks which LinkedIn accounts send its LinkedIn steps, mirroring
-- inbox_ids for email. LinkedIn queue rows round-robin across these.
alter table public.campaigns
  add column if not exists linkedin_account_ids uuid[] not null default '{}';

-- The queue carries both channels. A linkedin row has channel='linkedin',
-- inbox_id null, and is assigned a linkedin_account_id instead.
alter table public.send_queue
  add column if not exists channel text not null default 'email'
    check (channel in ('email', 'linkedin')),
  add column if not exists linkedin_account_id uuid
    references public.linkedin_accounts (id) on delete set null;

create index if not exists send_queue_linkedin_due_idx
  on public.send_queue (scheduled_at)
  where status = 'pending' and channel = 'linkedin';

-- Outbound LinkedIn record (parallel to public.emails). One row per LinkedIn
-- action sent, for the lead timeline + analytics + the once-per-step backstop.
create table public.linkedin_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  step_id uuid references public.campaign_steps (id) on delete set null,
  linkedin_account_id uuid references public.linkedin_accounts (id) on delete set null,
  action text not null check (action in ('connect', 'message', 'inmail')),
  unipile_chat_id text,
  unipile_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index linkedin_messages_workspace_idx on public.linkedin_messages (workspace_id);
create index linkedin_messages_lead_idx on public.linkedin_messages (lead_id);
-- One LinkedIn action per (campaign, lead, step) — the once-per-step backstop,
-- mirroring emails_campaign_lead_step_key. Nulls distinct so ad-hoc rows are free.
create unique index linkedin_messages_campaign_lead_step_key
  on public.linkedin_messages (campaign_id, lead_id, step_id);

-- Inbound LinkedIn messages unify into the existing replies table so the
-- unified inbox + Claude classifier need no changes.
alter table public.replies
  add column if not exists channel text not null default 'email'
    check (channel in ('email', 'linkedin')),
  add column if not exists linkedin_account_id uuid
    references public.linkedin_accounts (id) on delete set null,
  add column if not exists linkedin_chat_id text,     -- for replying in-thread
  add column if not exists linkedin_message_id text;  -- the inbound message id

-- Dedup LinkedIn replies per MESSAGE (a chat has many). Nulls distinct so
-- email rows are unconstrained.
create unique index if not exists replies_linkedin_message_key
  on public.replies (workspace_id, linkedin_message_id)
  where linkedin_message_id is not null;

-- ---------------------------------------------------------------------------
-- Workers: a third lease + channel-scoped claim functions
-- ---------------------------------------------------------------------------

-- Add a lease slot for the LinkedIn worker (id=3).
alter table public.worker_lease drop constraint worker_lease_id_check;
alter table public.worker_lease
  add constraint worker_lease_id_check check (id in (1, 2, 3));
insert into public.worker_lease (id, expires_at) values (3, now())
  on conflict (id) do nothing;

-- Re-scope the email claim to email rows only, so the send-worker never grabs a
-- LinkedIn row (channel added with default 'email', so existing rows are safe).
create or replace function public.claim_due_sends(p_limit integer)
returns setof public.send_queue
language plpgsql security definer set search_path = ''
as $$
begin
  return query
  update public.send_queue q
  set status = 'sending', updated_at = now()
  where q.id in (
    select s.id from public.send_queue s
    where s.status = 'pending' and s.scheduled_at <= now() and s.channel = 'email'
    order by s.scheduled_at
    limit greatest(p_limit, 0)
    for update skip locked
  )
  returning q.*;
end;
$$;
revoke execute on function public.claim_due_sends(integer) from public, anon, authenticated;
grant execute on function public.claim_due_sends(integer) to service_role;

-- The LinkedIn worker's atomic claim — same FOR UPDATE SKIP LOCKED guarantee.
create or replace function public.claim_due_linkedin(p_limit integer)
returns setof public.send_queue
language plpgsql security definer set search_path = ''
as $$
begin
  return query
  update public.send_queue q
  set status = 'sending', updated_at = now()
  where q.id in (
    select s.id from public.send_queue s
    where s.status = 'pending' and s.scheduled_at <= now() and s.channel = 'linkedin'
    order by s.scheduled_at
    limit greatest(p_limit, 0)
    for update skip locked
  )
  returning q.*;
end;
$$;
revoke execute on function public.claim_due_linkedin(integer) from public, anon, authenticated;
grant execute on function public.claim_due_linkedin(integer) to service_role;

-- ---------------------------------------------------------------------------
-- RLS on the new tables
-- ---------------------------------------------------------------------------
alter table public.linkedin_accounts enable row level security;
alter table public.linkedin_messages enable row level security;

do $$
declare t text;
begin
  foreach t in array array['linkedin_accounts', 'linkedin_messages'] loop
    execute format($f$
      create policy "members select %1$s" on public.%1$I for select
        to authenticated using (private.is_workspace_member(workspace_id));
      create policy "members insert %1$s" on public.%1$I for insert
        to authenticated with check (private.is_workspace_member(workspace_id));
      create policy "members update %1$s" on public.%1$I for update
        to authenticated using (private.is_workspace_member(workspace_id))
        with check (private.is_workspace_member(workspace_id));
      create policy "members delete %1$s" on public.%1$I for delete
        to authenticated using (private.is_workspace_member(workspace_id));
    $f$, t);
  end loop;
end;
$$;
