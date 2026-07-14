-- Phase 4: reply handling + unified inbox support (Section 5.4).
--
-- The reply-worker (lib/replies/*) runs as service_role and polls Gmail every
-- 5 min for new replies and bounce notifications. As with the send-worker, most
-- work is direct DML (service_role bypasses RLS); this file adds only:
--   * a SECOND worker lease row so the reply-worker serializes independently of
--     the send-worker (its poll/classify pass must not overlap itself either);
--   * per-inbox poll cursors for incremental Gmail sync;
--   * a domain bounce counter (Section 5.4: "increment domain bounce counter");
--   * the RPCs whose side effects must be atomic and are therefore unsafe to
--     express as a sequence of PostgREST calls from the worker:
--       - record_hard_bounce      (suppress + mark bounced + count, one txn)
--       - apply_reply_classification (classify + stage move / unsub / OOO resume)
--       - resume_sequence         (OOO auto-resume, un-does the stop trigger)
--
-- The stop-on-reply and suppression-cancel triggers already exist (Phase 1);
-- this file composes with them rather than duplicating their work.

-- ---------------------------------------------------------------------------
-- Second worker lease — the reply-worker gets its own serialization slot
-- ---------------------------------------------------------------------------

-- Phase 2 seeded lease id=1 for the send-worker and pinned id=1 with a check.
-- The reply-worker needs an independent lease (its tick can run concurrently
-- with a send tick, but never with another reply tick). Widen the check to
-- allow id=2 and seed it. The default stays 1 so nothing else changes.
alter table public.worker_lease
  drop constraint worker_lease_id_check;
alter table public.worker_lease
  add constraint worker_lease_id_check check (id in (1, 2));
insert into public.worker_lease (id, expires_at) values (2, now())
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Inbox poll cursors — incremental Gmail sync state
-- ---------------------------------------------------------------------------

-- last_history_id drives the Gmail History API (users.history.list startHistoryId)
-- for cheap incremental polling; last_poll_at is both a fallback query bound
-- (after:<epoch>) for the first poll and a liveness signal for the UI. poll_error
-- surfaces the last poll failure so a broken inbox is visible, not silent.
alter table public.inboxes
  add column if not exists last_history_id text,
  add column if not exists last_poll_at timestamptz,
  add column if not exists poll_error text;

-- ---------------------------------------------------------------------------
-- Domain bounce counter
-- ---------------------------------------------------------------------------

-- Section 5.4: a hard bounce increments the sending domain's counter; Section
-- 5.5 auto-pauses a domain past its bounce threshold. The precise 7d RATE is
-- computed from public.emails in Phase 5 analytics; this running counter is the
-- cheap signal the bounce handler bumps in the same transaction as the suppress.
alter table public.sending_domains
  add column if not exists bounce_count integer not null default 0;

-- ---------------------------------------------------------------------------
-- reply_thread_key: match an inbound Gmail message back to its lead + email
-- ---------------------------------------------------------------------------

-- The worker matches a reply to the originating send by Gmail thread id. Index
-- emails by (workspace_id, inbox_id, gmail_thread_id) so that lookup is cheap.
create index if not exists emails_thread_idx
  on public.emails (workspace_id, inbox_id, gmail_thread_id)
  where gmail_thread_id is not null;

-- Dedupe replies: the same Gmail message must never be recorded twice across
-- overlapping/rewound polls. Nulls are distinct so app-created rows (no gmail id)
-- are unconstrained.
create unique index if not exists replies_gmail_message_key
  on public.replies (workspace_id, gmail_message_id)
  where gmail_message_id is not null;

-- ---------------------------------------------------------------------------
-- record_hard_bounce — suppress globally, mark bounced, count (one txn)
-- ---------------------------------------------------------------------------

-- A hard bounce means the address is permanently undeliverable. Section 5.4:
-- suppress GLOBALLY (across every venture) and bump the domain counter.
--
-- Two safety properties, because bounce notifications are redelivered by
-- overlapping/rewound Gmail polls and are NOT deduped upstream:
--   * SCOPED — we act only if the bounced address is a lead THIS workspace
--     actually holds. A cold inbox receives misdirected/spoofed daemon mail;
--     we must not globally suppress an address we never emailed (a live lead
--     another venture wants would be lost forever).
--   * IDEMPOTENT — if the lead is already 'bounced', a redelivered
--     notification is a no-op. Otherwise the counter + event would inflate on
--     every repeat and can wrongly trip the Section 5.5 domain auto-pause.
-- Only after those checks do we suppress globally, flag the lead 'bounced',
-- mark the delivered email row(s), record the event, and bump the domain.
create or replace function public.record_hard_bounce(
  p_workspace_id uuid,
  p_email text,
  p_inbox_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_norm text := lower(trim(p_email));
  v_domain_id uuid;
  v_lead_id uuid;
  v_lead_status text;
begin
  if v_norm is null or position('@' in v_norm) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  -- SCOPE: only a lead this workspace holds. No lead → misdirected bounce, skip.
  select id, status into v_lead_id, v_lead_status
  from public.leads
  where workspace_id = p_workspace_id and email = v_norm;
  if v_lead_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_lead');
  end if;

  -- IDEMPOTENCY: already recorded (redelivered notification) → no-op, so the
  -- counter/event never double-count.
  if v_lead_status = 'bounced' then
    return jsonb_build_object('ok', true, 'lead_id', v_lead_id, 'duplicate', true);
  end if;

  -- Global suppression (workspace_id null). The insert trigger cancels pending
  -- queue rows and marks matching leads suppressed across ventures.
  insert into public.suppression (workspace_id, email, reason)
  values (null, v_norm, 'bounce')
  on conflict (workspace_id, email) do nothing;

  -- Refine this lead to the more specific 'bounced' (the trigger set 'suppressed').
  update public.leads
  set status = 'bounced', updated_at = now()
  where id = v_lead_id;

  -- Flag the delivered email row(s) for this lead so analytics counts the bounce.
  update public.emails
  set bounced = true,
      bounce_type = 'hard'
  where workspace_id = p_workspace_id
    and lead_id = v_lead_id
    and bounced = false;

  insert into public.events (workspace_id, type, meta)
  values (
    p_workspace_id,
    'bounce',
    jsonb_build_object('email', v_norm, 'bounce_type', 'hard')
  );

  -- Increment the sending domain's bounce counter (via the inbox that sent).
  if p_inbox_id is not null then
    select domain_id into v_domain_id
    from public.inboxes
    where id = p_inbox_id and workspace_id = p_workspace_id;
    if v_domain_id is not null then
      update public.sending_domains
      set bounce_count = bounce_count + 1, updated_at = now()
      where id = v_domain_id and workspace_id = p_workspace_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id, 'domain_id', v_domain_id);
end;
$$;

revoke execute on function public.record_hard_bounce(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.record_hard_bounce(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- resume_sequence — OOO auto-resume (reverses the stop trigger, delayed)
-- ---------------------------------------------------------------------------

-- When a reply is an out-of-office bounce-back, we should NOT stop the sequence
-- permanently (Section 5.4). The stop trigger already ran on the reply insert:
-- it flipped campaign_leads to 'replied' and cancelled the pending queue rows
-- (error='stopped_on_reply'). This RPC un-does exactly that, rescheduled to
-- p_resume_at, but only while the lead is still active (never resurrect a lead
-- that has since bounced/unsubscribed). Scoped to one lead; all its stopped
-- campaigns resume together, mirroring how the stop trigger stopped them.
create or replace function public.resume_sequence(
  p_workspace_id uuid,
  p_lead_id uuid,
  p_resume_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_status text;
  v_resumed integer := 0;
begin
  select status into v_lead_status
  from public.leads
  where id = p_lead_id and workspace_id = p_workspace_id;
  -- Only resume a still-mailable lead. A lead suppressed/bounced/unsubscribed
  -- between the reply and classification must stay stopped.
  if v_lead_status is distinct from 'active' then
    return 0;
  end if;

  update public.campaign_leads
  set status = 'active', next_send_at = p_resume_at, updated_at = now()
  where workspace_id = p_workspace_id
    and lead_id = p_lead_id
    and status = 'replied';

  update public.send_queue
  set status = 'pending',
      scheduled_at = p_resume_at,
      error = null,
      updated_at = now()
  where workspace_id = p_workspace_id
    and lead_id = p_lead_id
    and status = 'cancelled'
    and error = 'stopped_on_reply';
  get diagnostics v_resumed = row_count;

  return v_resumed;
end;
$$;

revoke execute on function public.resume_sequence(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.resume_sequence(uuid, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- apply_reply_classification — record the label + its side effects
-- ---------------------------------------------------------------------------

-- After the Claude classifier labels a reply, persist the label and apply the
-- one action it implies, atomically:
--   interested / referral / meeting  -> advance the lead to the Interested stage
--                                        (never downgrade Meeting/Client/Lost)
--   unsubscribe_request               -> global suppress + mark lead unsubscribed
--   ooo                               -> auto-resume the sequence at p_ooo_resume_at
--   not_interested / bounce / other   -> just mark handled
-- Returns a summary so the worker can log what happened.
create or replace function public.apply_reply_classification(
  p_reply_id uuid,
  p_classification text,
  p_confidence numeric,
  p_ooo_resume_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_lead_id uuid;
  v_email text;
  v_action text := 'none';
  v_resumed integer := 0;
begin
  select workspace_id, lead_id into v_ws, v_lead_id
  from public.replies
  where id = p_reply_id;
  if v_ws is null then
    return jsonb_build_object('ok', false, 'reason', 'reply_not_found');
  end if;

  update public.replies
  set classification = p_classification,
      confidence = p_confidence,
      handled = true
  where id = p_reply_id;

  if v_lead_id is null then
    return jsonb_build_object('ok', true, 'action', 'none', 'lead_id', null);
  end if;

  if p_classification in ('interested', 'referral', 'meeting') then
    -- Advance to Interested, but never pull a lead BACK from a later stage.
    update public.leads
    set owner_stage = 'Interested', updated_at = now()
    where id = v_lead_id
      and workspace_id = v_ws
      and owner_stage in ('New', 'Contacted', 'Replied');
    v_action := 'moved_to_interested';

  elsif p_classification = 'unsubscribe_request' then
    select email into v_email from public.leads
    where id = v_lead_id and workspace_id = v_ws;
    if v_email is not null then
      insert into public.suppression (workspace_id, email, reason)
      values (null, v_email, 'unsubscribe')
      on conflict (workspace_id, email) do nothing;
      update public.leads
      set status = 'unsubscribed', updated_at = now()
      where id = v_lead_id and workspace_id = v_ws;
    end if;
    v_action := 'unsubscribed';

  elsif p_classification = 'ooo' then
    -- Auto-resume ONLY if this out-of-office is the lead's sole engagement. A
    -- genuine reply does NOT change leads.status (the stop trigger only touches
    -- campaign_leads + the queue), so the leads.status='active' guard inside
    -- resume_sequence can't tell an OOO-stop from a real-reply-stop. Block the
    -- resume if ANY other reply for this lead is classified as something other
    -- than 'ooo' — or is still unclassified (it might be genuine). This keeps a
    -- prospect who actually replied from being pulled back into cold outreach
    -- by an auto-responder that fired on the same thread.
    if p_ooo_resume_at is not null then
      if exists (
        select 1 from public.replies r
        where r.workspace_id = v_ws
          and r.lead_id = v_lead_id
          and r.id <> p_reply_id
          and r.classification is distinct from 'ooo'
      ) then
        v_action := 'ooo_no_resume_engaged';
      else
        v_resumed := public.resume_sequence(v_ws, v_lead_id, p_ooo_resume_at);
        v_action := 'resumed';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', v_action,
    'lead_id', v_lead_id,
    'resumed', v_resumed
  );
end;
$$;

revoke execute on function public.apply_reply_classification(uuid, text, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_reply_classification(uuid, text, numeric, timestamptz) to service_role;
