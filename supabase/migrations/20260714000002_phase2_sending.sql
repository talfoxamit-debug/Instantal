-- Phase 2: sending engine support. The send-worker runs as service_role and
-- does most work via direct DML (service_role bypasses RLS); the only pieces
-- that MUST be database functions are the atomic queue claim (needs
-- FOR UPDATE SKIP LOCKED, not expressible over PostgREST) and the public
-- unsubscribe path (must work for an anonymous recipient with no session).
--
-- Ramp/cap/gap enforcement lives in the worker (lib/sending/*), which owns
-- a single source of truth in TS; this file only provides the safe
-- concurrency primitive and the compliance RPCs.

-- ---------------------------------------------------------------------------
-- unsub_tokens: one stable token per (workspace, lead, campaign)
-- ---------------------------------------------------------------------------

-- NULLS NOT DISTINCT so a null campaign_id (workspace-wide unsub) dedupes.
create unique index unsub_tokens_scope_key
  on public.unsub_tokens (workspace_id, lead_id, campaign_id) nulls not distinct;

-- ---------------------------------------------------------------------------
-- One-send-per-(lead,step) backstop
-- ---------------------------------------------------------------------------

-- A lead receives each campaign step at most once. This unique constraint is
-- the last line of defense against a double-send: even a worker logic bug
-- can't record (or, with the pre-send insert, dispatch) the same step twice.
-- Nulls are distinct, so non-campaign emails are unconstrained.
alter table public.emails
  add constraint emails_campaign_lead_step_key
  unique (campaign_id, lead_id, step_id);

-- ---------------------------------------------------------------------------
-- Worker lease — only one send-worker tick runs at a time
-- ---------------------------------------------------------------------------

-- The worker enforces per-inbox caps/gaps with read-then-write logic that is
-- only correct if a single tick runs at a time. pg_cron fires every minute and
-- a run can span a minute, so ticks could otherwise overlap and both read
-- stale counters. This single-row lease serializes them: a tick acquires the
-- lease (bounded by a short TTL so a crashed worker can't hold it forever) or
-- skips. RLS on with no policies = only service_role (the worker) can touch it.
create table public.worker_lease (
  id integer primary key default 1 check (id = 1),
  holder text,
  expires_at timestamptz not null default now()
);
insert into public.worker_lease (id, expires_at) values (1, now());
alter table public.worker_lease enable row level security;

-- ---------------------------------------------------------------------------
-- Atomic queue claim — the guard against double-sends
-- ---------------------------------------------------------------------------

-- Claim up to p_limit due pending rows, flipping them to 'sending' under
-- FOR UPDATE SKIP LOCKED so two overlapping worker invocations never grab the
-- same row. Returns the claimed rows for the worker to process. Rows the
-- worker decides not to send this tick (cap/gap) are released back to
-- 'pending' by the worker via a normal UPDATE.
--
-- Deliberately does NOT touch `attempts`: the worker re-claims and releases
-- rows every tick under cap/gap throttling, so counting a claim as an attempt
-- would falsely exhaust the retry budget. attempts is bumped only on a real
-- send failure, by the worker.
create or replace function public.claim_due_sends(p_limit integer)
returns setof public.send_queue
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.send_queue q
  set status = 'sending',
      updated_at = now()
  where q.id in (
    select s.id
    from public.send_queue s
    where s.status = 'pending'
      and s.scheduled_at <= now()
    order by s.scheduled_at
    limit greatest(p_limit, 0)
    for update skip locked
  )
  returning q.*;
end;
$$;

revoke execute on function public.claim_due_sends(integer) from public, anon, authenticated;
grant execute on function public.claim_due_sends(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Unsubscribe token issuance (worker builds footer links from this)
-- ---------------------------------------------------------------------------

create or replace function public.ensure_unsub_token(
  p_workspace_id uuid,
  p_lead_id uuid,
  p_campaign_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  select token into v_token
  from public.unsub_tokens
  where workspace_id = p_workspace_id
    and lead_id = p_lead_id
    and campaign_id is not distinct from p_campaign_id;
  if v_token is not null then
    return v_token;
  end if;

  -- 128-bit unguessable token. gen_random_uuid() is built-in (pg_catalog) so
  -- it resolves under the pinned empty search_path; gen_random_bytes would
  -- need the pgcrypto/extensions schema and is avoided here.
  v_token := replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.unsub_tokens (token, workspace_id, lead_id, campaign_id)
    values (v_token, p_workspace_id, p_lead_id, p_campaign_id);
  exception when unique_violation then
    -- Concurrent issuer won the race; return the persisted token.
    select token into v_token
    from public.unsub_tokens
    where workspace_id = p_workspace_id
      and lead_id = p_lead_id
      and campaign_id is not distinct from p_campaign_id;
  end;
  return v_token;
end;
$$;

revoke execute on function public.ensure_unsub_token(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_unsub_token(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Public unsubscribe — runs for an anonymous recipient (one-click)
-- ---------------------------------------------------------------------------

-- Resolve an unsub token, add a GLOBAL suppression (opt-out honored across
-- every venture, Section 6), and mark the originating lead + its campaign
-- memberships unsubscribed. The suppression-insert trigger cancels pending
-- sends and marks matching leads suppressed; we then override the originating
-- lead to the more specific 'unsubscribed'. Idempotent and unguessable-token
-- gated, so it is safe to expose to anon.
create or replace function public.process_unsubscribe(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_lead_id uuid;
  v_email text;
begin
  select workspace_id, lead_id into v_ws, v_lead_id
  from public.unsub_tokens
  where token = p_token;

  if v_lead_id is null then
    return jsonb_build_object('ok', false);
  end if;

  select email into v_email from public.leads where id = v_lead_id;
  if v_email is null then
    return jsonb_build_object('ok', false);
  end if;

  insert into public.suppression (workspace_id, email, reason)
  values (null, v_email, 'unsubscribe')
  on conflict (workspace_id, email) do nothing;

  update public.leads
  set status = 'unsubscribed', updated_at = now()
  where id = v_lead_id;

  update public.campaign_leads
  set status = 'unsubscribed', updated_at = now()
  where lead_id = v_lead_id and status in ('queued', 'active');

  insert into public.events (workspace_id, type, meta)
  values (v_ws, 'unsub', jsonb_build_object('email', v_email, 'source', 'one_click'));

  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

revoke execute on function public.process_unsubscribe(text) from public;
grant execute on function public.process_unsubscribe(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tracking event recorder (open pixel / click redirect), anon-callable
-- ---------------------------------------------------------------------------

-- Record an open/click against an email and stamp the first timestamp. Keyed
-- by the email id embedded in the tracking URL; SECURITY DEFINER because the
-- recipient's browser is anonymous. Never leaks data back (returns void).
create or replace function public.record_tracking_event(
  p_email_id uuid,
  p_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  if p_type not in ('open', 'click') then
    return;
  end if;
  select workspace_id into v_ws from public.emails where id = p_email_id;
  if v_ws is null then
    return;
  end if;

  insert into public.events (workspace_id, email_id, type)
  values (v_ws, p_email_id, p_type);

  if p_type = 'open' then
    update public.emails
    set opened_at = coalesce(opened_at, now())
    where id = p_email_id;
  else
    update public.emails
    set first_click_at = coalesce(first_click_at, now())
    where id = p_email_id;
  end if;
end;
$$;

revoke execute on function public.record_tracking_event(uuid, text) from public;
grant execute on function public.record_tracking_event(uuid, text) to anon, authenticated, service_role;
