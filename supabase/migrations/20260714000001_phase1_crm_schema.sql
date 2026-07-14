-- Phase 1: full Section 4 schema (CRM core + the sending/reply tables later
-- phases fill in). Every table carries workspace_id + RLS reusing the
-- private.is_workspace_member / private.is_workspace_owner helpers from the
-- Phase 0 migration. See OUTREACH-BUILD-PLAN.md Section 4.
--
-- Convention in this file: "enum-like" columns use text + CHECK (not PG
-- enums) so later phases can widen the allowed set with a plain migration,
-- matching the Phase 0 style.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Normalize any email column to lower(trim(...)) so dedup + suppression
-- matching are case-insensitive and whitespace-safe at the storage layer.
create or replace function private.normalize_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.email is not null then
    new.email := lower(trim(new.email));
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- Sending infrastructure (populated in Phase 2; tables exist now)
-- ===========================================================================

create table public.sending_domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  domain text not null,
  tracking_domain text,
  dns_spf boolean not null default false,
  dns_dkim boolean not null default false,
  dns_dmarc boolean not null default false,
  dns_verified_at timestamptz,
  redirect_ok boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'verifying', 'active', 'paused', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, domain)
);

create index sending_domains_workspace_idx
  on public.sending_domains (workspace_id);

create table public.inboxes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  domain_id uuid references public.sending_domains (id) on delete set null,
  email text not null,
  display_name text,
  provider text not null default 'google'
    check (provider in ('google', 'microsoft', 'other')),
  -- Encrypted at the app layer (Phase 2). Never a plaintext token.
  oauth_refresh_token_enc text,
  daily_cap integer not null default 40 check (daily_cap between 0 and 500),
  current_ramp_cap integer not null default 0 check (current_ramp_cap >= 0),
  warmup_started_at timestamptz,
  warmup_status text not null default 'not_started'
    check (warmup_status in ('not_started', 'warming', 'ready', 'paused')),
  health_score numeric(5, 2),
  last_send_at timestamptz,
  status text not null default 'paused'
    check (status in ('active', 'paused', 'burned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email)
);

create index inboxes_workspace_idx on public.inboxes (workspace_id);
create index inboxes_domain_idx on public.inboxes (domain_id);

-- ===========================================================================
-- CRM core (Phase 1)
-- ===========================================================================

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  first_name text,
  last_name text,
  company text,
  title text,
  phone text,
  website text,
  -- v1 targets US leads; country is captured so EU/Canada rules (GDPR/CASL)
  -- become enforceable later (Section 6).
  country text,
  custom jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  source text,
  verify_status text not null default 'unverified'
    check (verify_status in
      ('unverified', 'pending', 'valid', 'invalid', 'risky', 'unknown')),
  verify_checked_at timestamptz,
  -- General lifecycle flag (distinct from pipeline stage below).
  status text not null default 'active'
    check (status in ('active', 'unsubscribed', 'bounced', 'suppressed')),
  -- Pipeline stage (Section 5.1 kanban).
  owner_stage text not null default 'New'
    check (owner_stage in
      ('New', 'Contacted', 'Replied', 'Interested', 'Meeting', 'Client', 'Lost')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Import dedupes on this (Section 4 key constraint).
  unique (workspace_id, email)
);

create index leads_workspace_idx on public.leads (workspace_id);
create index leads_workspace_stage_idx on public.leads (workspace_id, owner_stage);
create index leads_workspace_status_idx on public.leads (workspace_id, verify_status);
create index leads_tags_idx on public.leads using gin (tags);

create trigger leads_normalize_email
  before insert or update of email on public.leads
  for each row execute function private.normalize_email();

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function private.set_updated_at();

create table public.lead_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create index lead_lists_workspace_idx on public.lead_lists (workspace_id);

create trigger lead_lists_set_updated_at
  before update on public.lead_lists
  for each row execute function private.set_updated_at();

create table public.list_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  list_id uuid not null references public.lead_lists (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id, lead_id)
);

create index list_members_workspace_idx on public.list_members (workspace_id);
create index list_members_lead_idx on public.list_members (lead_id);

-- ===========================================================================
-- Campaign engine (populated in Phase 3; tables exist now)
-- ===========================================================================

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'finished', 'archived')),
  list_id uuid references public.lead_lists (id) on delete set null,
  inbox_ids uuid[] not null default '{}',
  send_window_start time not null default '09:00',
  send_window_end time not null default '17:00',
  send_days integer[] not null default '{1,2,3,4,5}',  -- ISO dow: 1=Mon..7=Sun
  timezone_mode text not null default 'lead'
    check (timezone_mode in ('lead', 'fixed')),
  fixed_timezone text,
  track_opens boolean not null default false,   -- off by default (Section 5.5)
  track_clicks boolean not null default false,
  daily_limit integer check (daily_limit is null or daily_limit >= 0),
  stop_on_reply boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index campaigns_workspace_idx on public.campaigns (workspace_id);

create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function private.set_updated_at();

create table public.campaign_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  step_no integer not null check (step_no >= 1),
  delay_days integer not null default 0 check (delay_days >= 0),
  subject text,
  body_html text,
  body_text text,
  -- A/B variants share a step_no; variant_group distinguishes them.
  variant_group text not null default 'A',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, step_no, variant_group)
);

create index campaign_steps_workspace_idx on public.campaign_steps (workspace_id);
create index campaign_steps_campaign_idx on public.campaign_steps (campaign_id);

create trigger campaign_steps_set_updated_at
  before update on public.campaign_steps
  for each row execute function private.set_updated_at();

create table public.campaign_leads (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  current_step integer not null default 0,
  status text not null default 'queued'
    check (status in
      ('queued', 'active', 'replied', 'bounced', 'unsubscribed', 'finished')),
  next_send_at timestamptz,
  thread_id text,
  last_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, lead_id)
);

create index campaign_leads_workspace_idx on public.campaign_leads (workspace_id);
create index campaign_leads_lead_idx on public.campaign_leads (lead_id);
create index campaign_leads_due_idx
  on public.campaign_leads (next_send_at)
  where status in ('queued', 'active');

create trigger campaign_leads_set_updated_at
  before update on public.campaign_leads
  for each row execute function private.set_updated_at();

-- ===========================================================================
-- Sending queue + delivery records (populated in Phase 2/4; exist now)
-- ===========================================================================

create table public.send_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  step_id uuid references public.campaign_steps (id) on delete set null,
  inbox_id uuid references public.inboxes (id) on delete set null,
  scheduled_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The send-worker (Phase 2) polls due pending rows; index for that path.
create index send_queue_due_idx
  on public.send_queue (scheduled_at)
  where status = 'pending';
create index send_queue_workspace_idx on public.send_queue (workspace_id);
create index send_queue_lead_idx on public.send_queue (lead_id);

create trigger send_queue_set_updated_at
  before update on public.send_queue
  for each row execute function private.set_updated_at();

create table public.emails (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  step_id uuid references public.campaign_steps (id) on delete set null,
  inbox_id uuid references public.inboxes (id) on delete set null,
  gmail_message_id text,
  gmail_thread_id text,
  subject text,
  sent_at timestamptz,
  opened_at timestamptz,
  first_click_at timestamptz,
  bounced boolean not null default false,
  bounce_type text check (bounce_type in ('hard', 'soft')),
  created_at timestamptz not null default now()
);

create index emails_workspace_idx on public.emails (workspace_id);
create index emails_lead_idx on public.emails (lead_id);
create index emails_campaign_idx on public.emails (campaign_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email_id uuid references public.emails (id) on delete cascade,
  type text not null
    check (type in ('open', 'click', 'reply', 'bounce', 'unsub', 'send')),
  ts timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create index events_workspace_idx on public.events (workspace_id);
create index events_email_idx on public.events (email_id);

create table public.replies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email_id uuid references public.emails (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  gmail_message_id text,
  body_text text,
  received_at timestamptz not null default now(),
  classification text
    check (classification is null or classification in
      ('interested', 'not_interested', 'ooo', 'referral',
       'unsubscribe_request', 'bounce', 'other')),
  confidence numeric(4, 3),
  handled boolean not null default false,
  created_at timestamptz not null default now()
);

create index replies_workspace_idx on public.replies (workspace_id);
create index replies_lead_idx on public.replies (lead_id);
create index replies_unhandled_idx
  on public.replies (workspace_id) where handled = false;

-- ===========================================================================
-- Compliance: suppression + unsubscribe tokens
-- ===========================================================================

create table public.suppression (
  id uuid primary key default gen_random_uuid(),
  -- null workspace_id = global suppression across every venture (Section 4).
  workspace_id uuid references public.workspaces (id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  reason text not null default 'manual',
  created_at timestamptz not null default now(),
  -- NULLS NOT DISTINCT (PG15+) so two global entries for the same email
  -- collide instead of duplicating.
  unique nulls not distinct (workspace_id, email)
);

create index suppression_email_idx on public.suppression (email);
create index suppression_workspace_idx on public.suppression (workspace_id);

create trigger suppression_normalize_email
  before insert or update of email on public.suppression
  for each row execute function private.normalize_email();

create table public.unsub_tokens (
  token text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index unsub_tokens_workspace_idx on public.unsub_tokens (workspace_id);
create index unsub_tokens_lead_idx on public.unsub_tokens (lead_id);

create table public.health_checks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  domain_id uuid references public.sending_domains (id) on delete cascade,
  check_type text not null,
  result jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);

create index health_checks_workspace_idx on public.health_checks (workspace_id);
create index health_checks_domain_idx on public.health_checks (domain_id);

-- ===========================================================================
-- Suppression helpers + enforcement
-- ===========================================================================

-- True if `p_email` is suppressed for the workspace: either a global entry
-- (workspace_id null) or one scoped to that workspace. Used by the send-worker
-- (Phase 2). Lives in the `private` schema (NOT public) so PostgREST never
-- exposes it as an RPC — otherwise, being SECURITY DEFINER with no membership
-- check, it would be a cross-workspace suppression-existence oracle. Server-
-- side callers (the worker, under service_role) reach it directly.
create or replace function private.is_suppressed(p_workspace_id uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.suppression s
    where s.email = lower(trim(p_email))
      and (s.workspace_id is null or s.workspace_id = p_workspace_id)
  );
$$;

revoke execute on function private.is_suppressed(uuid, text) from public, anon;
grant execute on function private.is_suppressed(uuid, text) to authenticated, service_role;

-- Atomically append a tag to many leads without a read-modify-write race.
-- SECURITY INVOKER (default) so RLS on leads applies — a caller can only tag
-- leads in workspaces they belong to. The dedup + append happen inside one
-- UPDATE statement, so concurrent taggers cannot lose each other's writes.
create or replace function public.add_tag_to_leads(
  p_workspace_id uuid,
  p_lead_ids uuid[],
  p_tag text
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_tag text := trim(p_tag);
  v_count integer;
begin
  if v_tag = '' then
    return 0;
  end if;
  update public.leads
  set tags = (
        select array_agg(distinct t order by t)
        from unnest(tags || array[v_tag]) as t
      ),
      updated_at = now()
  where workspace_id = p_workspace_id
    and id = any(p_lead_ids)
    and not (tags @> array[v_tag]);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.add_tag_to_leads(uuid, uuid[], text) from public, anon;
grant execute on function public.add_tag_to_leads(uuid, uuid[], text) to authenticated;

-- When an email is suppressed, cancel every pending/sending queue row for
-- matching leads (Section 4 trigger). Global suppression cancels everywhere;
-- workspace-scoped cancels within that workspace.
create or replace function private.suppression_cancel_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.send_queue q
  set status = 'cancelled',
      error = coalesce(q.error, 'suppressed'),
      updated_at = now()
  from public.leads l
  where q.lead_id = l.id
    and q.status in ('pending', 'sending')
    and l.email = new.email
    and (new.workspace_id is null or l.workspace_id = new.workspace_id);

  -- Reflect suppression on matching lead rows too, so the CRM shows it.
  update public.leads l
  set status = 'suppressed', updated_at = now()
  where l.email = new.email
    and l.status <> 'suppressed'
    and (new.workspace_id is null or l.workspace_id = new.workspace_id);

  return new;
end;
$$;

create trigger suppression_cancel_queue_after_insert
  after insert on public.suppression
  for each row execute function private.suppression_cancel_queue();

-- When a reply is recorded and the campaign is stop_on_reply, stop the
-- sequence for that lead and drop its pending queue rows (Section 4 trigger).
create or replace function private.reply_stop_sequence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lead_id is null then
    return new;
  end if;

  update public.campaign_leads cl
  set status = 'replied', updated_at = now()
  from public.campaigns c
  where cl.campaign_id = c.id
    and cl.lead_id = new.lead_id
    and cl.workspace_id = new.workspace_id
    and cl.status in ('queued', 'active')
    and c.stop_on_reply = true;

  update public.send_queue q
  set status = 'cancelled',
      error = coalesce(q.error, 'stopped_on_reply'),
      updated_at = now()
  from public.campaigns c
  where q.campaign_id = c.id
    and q.lead_id = new.lead_id
    and q.workspace_id = new.workspace_id
    and q.status = 'pending'
    and c.stop_on_reply = true;

  return new;
end;
$$;

create trigger replies_stop_sequence_after_insert
  after insert on public.replies
  for each row execute function private.reply_stop_sequence();

-- ===========================================================================
-- Row level security: every table, member-scoped CRUD
-- ===========================================================================

alter table public.sending_domains enable row level security;
alter table public.inboxes enable row level security;
alter table public.leads enable row level security;
alter table public.lead_lists enable row level security;
alter table public.list_members enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_steps enable row level security;
alter table public.campaign_leads enable row level security;
alter table public.send_queue enable row level security;
alter table public.emails enable row level security;
alter table public.events enable row level security;
alter table public.replies enable row level security;
alter table public.suppression enable row level security;
alter table public.unsub_tokens enable row level security;
alter table public.health_checks enable row level security;

-- Standard member-scoped policy set applied to workspace-owned tables.
-- Each gets SELECT/INSERT/UPDATE/DELETE gated on workspace membership.
do $$
declare
  t text;
  member_tables text[] := array[
    'sending_domains', 'inboxes', 'leads', 'lead_lists', 'list_members',
    'campaigns', 'campaign_steps', 'campaign_leads', 'send_queue',
    'emails', 'events', 'replies', 'unsub_tokens', 'health_checks'
  ];
begin
  foreach t in array member_tables loop
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

-- Suppression is special: global rows (workspace_id null) are visible and
-- insertable by any authenticated member (an opt-out is safe to share and
-- must propagate across ventures for compliance). Deletion is owner-only,
-- since suppression is meant to be permanent (Section 6).
create policy "members select suppression" on public.suppression for select
  to authenticated
  using (workspace_id is null or private.is_workspace_member(workspace_id));

create policy "members insert suppression" on public.suppression for insert
  to authenticated
  with check (workspace_id is null or private.is_workspace_member(workspace_id));

-- Owners may delete only their OWN workspace's suppression rows, to correct a
-- mistaken workspace-scoped entry. GLOBAL rows (workspace_id null) are never
-- deletable through the API: suppression is "forever, globally across
-- ventures" (Section 6), and letting any one venture's owner un-suppress an
-- address for every other venture is a cross-tenant compliance breach.
-- A genuine global-row removal is a deliberate service_role operation.
create policy "owners delete workspace suppression" on public.suppression for delete
  to authenticated
  using (workspace_id is not null and private.is_workspace_owner(workspace_id));
