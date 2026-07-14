-- Phase 5: deliverability ops + analytics (Sections 5.5, 5.6).
--
-- Analytics are read aggregations over emails/replies. They are SECURITY
-- INVOKER (plain SQL) so the caller's RLS applies — a member only ever sees
-- their own workspaces' numbers, and the p_workspace_id argument is just a
-- filter on top of that. The auto-pause evaluator is the exception: it is
-- SECURITY DEFINER and service_role-only because the daily health-worker must
-- pause inboxes/domains across every workspace, which RLS would otherwise hide.

-- ---------------------------------------------------------------------------
-- Columns: pause reason + last error (health dashboard, alerting)
-- ---------------------------------------------------------------------------

alter table public.inboxes
  add column if not exists pause_reason text,
  add column if not exists last_error text,
  add column if not exists last_error_at timestamptz,
  -- When the entity last became 'active'. Auto-pause measures the bounce rate
  -- only over sends SINCE this moment, so reactivating after a fix gives a real
  -- grace period instead of an instant re-pause on the same stale bounces.
  add column if not exists last_activated_at timestamptz;

alter table public.sending_domains
  add column if not exists pause_reason text,
  add column if not exists last_activated_at timestamptz;

-- Stamp last_activated_at whenever status transitions to 'active' (any path:
-- UI reactivation, manual SQL, first activation). Scoped to `update of status`
-- so the send-worker's frequent last_send_at writes don't fire it.
create or replace function private.stamp_activation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'active'
     and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    new.last_activated_at := now();
  end if;
  return new;
end;
$$;

create trigger inboxes_stamp_activation
  before insert or update of status on public.inboxes
  for each row execute function private.stamp_activation();

create trigger sending_domains_stamp_activation
  before insert or update of status on public.sending_domains
  for each row execute function private.stamp_activation();

-- ===========================================================================
-- Analytics (Section 5.6)
-- ===========================================================================

-- Per-variant campaign stats. "delivered" = sent and not bounced (Gmail gives
-- no explicit delivery receipt, so a non-bounce is treated as delivered).
-- "positive" = an 'interested' reply, the number that decides A/B winners.
-- Replies attribute to the step whose email was replied to (reply.email_id ->
-- emails.step_id). Rates are computed by the caller to avoid div-by-zero here.
create or replace function public.campaign_variant_stats(
  p_workspace_id uuid,
  p_campaign_id uuid
)
returns table (
  step_no integer,
  variant_group text,
  step_id uuid,
  sent bigint,
  delivered bigint,
  bounced bigint,
  replies bigint,
  positive bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.step_no,
    s.variant_group,
    s.id as step_id,
    -- count(distinct e.id), NOT count(e.id): the replies join fans an email out
    -- into one row per reply, so a plain count would double-count sends for any
    -- email that got multiple replies.
    count(distinct e.id) filter (where e.sent_at is not null) as sent,
    count(distinct e.id) filter (where e.sent_at is not null and e.bounced = false) as delivered,
    count(distinct e.id) filter (where e.bounced) as bounced,
    count(distinct r.id) as replies,
    count(distinct r.id) filter (where r.classification = 'interested') as positive
  from public.campaign_steps s
  left join public.emails e
    on e.step_id = s.id and e.workspace_id = p_workspace_id
  left join public.replies r
    on r.email_id = e.id and r.workspace_id = p_workspace_id
  where s.workspace_id = p_workspace_id
    and s.campaign_id = p_campaign_id
  group by s.step_no, s.variant_group, s.id
  order by s.step_no, s.variant_group;
$$;

-- Per-campaign rollup for the workspace (one row per campaign, summed across
-- steps/variants). Drives the analytics table + workspace rollup.
create or replace function public.workspace_campaign_stats(p_workspace_id uuid)
returns table (
  campaign_id uuid,
  campaign_name text,
  status text,
  sent bigint,
  delivered bigint,
  bounced bigint,
  replies bigint,
  positive bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id as campaign_id,
    c.name as campaign_name,
    c.status,
    -- count(distinct e.id) so the replies join can't double-count sends.
    count(distinct e.id) filter (where e.sent_at is not null) as sent,
    count(distinct e.id) filter (where e.sent_at is not null and e.bounced = false) as delivered,
    count(distinct e.id) filter (where e.bounced) as bounced,
    count(distinct r.id) as replies,
    count(distinct r.id) filter (where r.classification = 'interested') as positive
  from public.campaigns c
  left join public.emails e
    on e.campaign_id = c.id and e.workspace_id = p_workspace_id
  left join public.replies r
    on r.email_id = e.id and r.workspace_id = p_workspace_id
  where c.workspace_id = p_workspace_id
  group by c.id, c.name, c.status
  order by c.created_at desc;
$$;

-- ===========================================================================
-- Deliverability health (Section 5.5)
-- ===========================================================================

-- Per-inbox health: today's volume vs cap, 7d bounce + reply counts (rates
-- computed by the caller), warmup + status + last error.
create or replace function public.inbox_health(p_workspace_id uuid)
returns table (
  inbox_id uuid,
  email text,
  status text,
  warmup_status text,
  warmup_started_at timestamptz,
  daily_cap integer,
  current_ramp_cap integer,
  pause_reason text,
  last_error text,
  last_error_at timestamptz,
  sends_today bigint,
  sent_7d bigint,
  bounced_7d bigint,
  replies_7d bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    i.id as inbox_id,
    i.email,
    i.status,
    i.warmup_status,
    i.warmup_started_at,
    i.daily_cap,
    i.current_ramp_cap,
    i.pause_reason,
    i.last_error,
    i.last_error_at,
    -- count(distinct e.id): the replies join fans emails out; a plain count
    -- would inflate send volume for any email with multiple replies.
    count(distinct e.id) filter (
      where e.sent_at >= date_trunc('day', now())
    ) as sends_today,
    count(distinct e.id) filter (where e.sent_at >= now() - interval '7 days') as sent_7d,
    count(distinct e.id) filter (
      where e.bounced and e.sent_at >= now() - interval '7 days'
    ) as bounced_7d,
    count(distinct r.id) filter (
      where r.received_at >= now() - interval '7 days'
    ) as replies_7d
  from public.inboxes i
  left join public.emails e
    on e.inbox_id = i.id and e.workspace_id = p_workspace_id
  left join public.replies r
    on r.email_id = e.id and r.workspace_id = p_workspace_id
  where i.workspace_id = p_workspace_id
  group by i.id
  order by i.email;
$$;

-- Per-domain health: 7d bounce volume aggregated across the domain's inboxes,
-- plus DNS status and the running bounce counter.
create or replace function public.domain_health(p_workspace_id uuid)
returns table (
  domain_id uuid,
  domain text,
  status text,
  dns_spf boolean,
  dns_dkim boolean,
  dns_dmarc boolean,
  dns_verified_at timestamptz,
  pause_reason text,
  bounce_count integer,
  sent_7d bigint,
  bounced_7d bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    d.id as domain_id,
    d.domain,
    d.status,
    d.dns_spf,
    d.dns_dkim,
    d.dns_dmarc,
    d.dns_verified_at,
    d.pause_reason,
    d.bounce_count,
    count(e.id) filter (where e.sent_at >= now() - interval '7 days') as sent_7d,
    count(e.id) filter (
      where e.bounced and e.sent_at >= now() - interval '7 days'
    ) as bounced_7d
  from public.sending_domains d
  left join public.inboxes i
    on i.domain_id = d.id and i.workspace_id = p_workspace_id
  left join public.emails e
    on e.inbox_id = i.id and e.workspace_id = p_workspace_id
  where d.workspace_id = p_workspace_id
  group by d.id
  order by d.domain;
$$;

-- ---------------------------------------------------------------------------
-- Auto-pause evaluator (Section 5.5)
-- ---------------------------------------------------------------------------

-- Pause any active inbox whose 7d bounce rate exceeds p_inbox_threshold, and
-- any active domain whose 7d bounce rate exceeds p_domain_threshold — but only
-- once at least p_min_volume sends exist in the window, so a rate over a tiny
-- denominator can't trip a pause. Runs as the daily health-worker (service_role,
-- cross-workspace). Returns the entities newly paused THIS run (status flipped
-- from 'active') so the worker can alert on exactly those, not on every
-- already-paused one. Idempotent: a re-run pauses nothing new.
create or replace function public.evaluate_deliverability(
  p_min_volume integer default 20,
  p_inbox_threshold numeric default 0.03,
  p_domain_threshold numeric default 0.05
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paused jsonb := '[]'::jsonb;
  rec record;
begin
  -- Inboxes over the bounce threshold.
  for rec in
    select i.id, i.workspace_id, i.email,
           s.sent_7d, s.bounced_7d,
           round(s.bounced_7d::numeric / nullif(s.sent_7d, 0), 4) as rate
    from public.inboxes i
    join lateral (
      select
        count(*) filter (where e.sent_at >= w.since) as sent_7d,
        count(*) filter (where e.bounced and e.sent_at >= w.since) as bounced_7d
      from (
        select greatest(now() - interval '7 days',
                        coalesce(i.last_activated_at, now() - interval '7 days')) as since
      ) w
      cross join public.emails e
      where e.inbox_id = i.id
    ) s on true
    where i.status = 'active'
      and s.sent_7d >= p_min_volume
      and s.bounced_7d::numeric / nullif(s.sent_7d, 0) > p_inbox_threshold
  loop
    update public.inboxes
    set status = 'paused',
        pause_reason = format('auto: 7d bounce rate %s%% (%s/%s)',
          round(rec.rate * 100, 1), rec.bounced_7d, rec.sent_7d),
        updated_at = now()
    where id = rec.id and status = 'active';
    if found then
      v_paused := v_paused || jsonb_build_object(
        'kind', 'inbox', 'id', rec.id, 'workspace_id', rec.workspace_id,
        'label', rec.email, 'rate', rec.rate,
        'sent_7d', rec.sent_7d, 'bounced_7d', rec.bounced_7d
      );
    end if;
  end loop;

  -- Domains over the (higher) bounce threshold.
  for rec in
    select d.id, d.workspace_id, d.domain,
           s.sent_7d, s.bounced_7d,
           round(s.bounced_7d::numeric / nullif(s.sent_7d, 0), 4) as rate
    from public.sending_domains d
    join lateral (
      select
        count(*) filter (where e.sent_at >= w.since) as sent_7d,
        count(*) filter (where e.bounced and e.sent_at >= w.since) as bounced_7d
      from (
        select greatest(now() - interval '7 days',
                        coalesce(d.last_activated_at, now() - interval '7 days')) as since
      ) w
      cross join public.inboxes i
      join public.emails e on e.inbox_id = i.id
      where i.domain_id = d.id
    ) s on true
    where d.status = 'active'
      and s.sent_7d >= p_min_volume
      and s.bounced_7d::numeric / nullif(s.sent_7d, 0) > p_domain_threshold
  loop
    update public.sending_domains
    set status = 'paused',
        pause_reason = format('auto: 7d bounce rate %s%% (%s/%s)',
          round(rec.rate * 100, 1), rec.bounced_7d, rec.sent_7d),
        updated_at = now()
    where id = rec.id and status = 'active';
    if found then
      v_paused := v_paused || jsonb_build_object(
        'kind', 'domain', 'id', rec.id, 'workspace_id', rec.workspace_id,
        'label', rec.domain, 'rate', rec.rate,
        'sent_7d', rec.sent_7d, 'bounced_7d', rec.bounced_7d
      );
      -- Pause the domain's inboxes too — a burned domain burns its senders.
      update public.inboxes
      set status = 'paused',
          pause_reason = coalesce(pause_reason, 'auto: sending domain paused'),
          updated_at = now()
      where domain_id = rec.id and status = 'active';
    end if;
  end loop;

  return v_paused;
end;
$$;

revoke execute on function public.evaluate_deliverability(integer, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.evaluate_deliverability(integer, numeric, numeric)
  to service_role;
