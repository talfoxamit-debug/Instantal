-- Inbox-placement (spam) testing — roadmap P1b. Send a tagged email from a real
-- sending inbox to a set of SEED mailboxes, then read each seed back via the
-- Gmail API to see whether it landed in inbox / promotions / spam. This is the
-- "SmartDelivery / Inbox Placement" feature the leaders ship (benchmark §3).
--
-- Seeds are ordinary connected Gmail mailboxes flagged is_seed=true: they only
-- RECEIVE test mail and must never be used to send, so they are excluded from
-- the sender list, health, analytics, and auto-pause below.

alter table public.inboxes
  add column if not exists is_seed boolean not null default false;

create table if not exists public.placement_tests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- The sending inbox under test.
  inbox_id uuid references public.inboxes (id) on delete set null,
  inbox_email text,
  -- Unique marker embedded in the subject so each seed can be found precisely.
  token text not null,
  status text not null default 'sent'
    check (status in ('sent', 'complete', 'failed')),
  seed_count integer not null default 0,
  inbox_count integer not null default 0,
  promotions_count integer not null default 0,
  spam_count integer not null default 0,
  missing_count integer not null default 0,
  -- Per-seed detail: [{ seed_email, placement: inbox|promotions|spam|missing }]
  results jsonb not null default '[]'::jsonb,
  error text,
  sent_at timestamptz not null default now(),
  checked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists placement_tests_workspace_idx
  on public.placement_tests (workspace_id, created_at desc);
create unique index if not exists placement_tests_token_key
  on public.placement_tests (token);

alter table public.placement_tests enable row level security;

create policy "members select placement_tests" on public.placement_tests for select
  to authenticated using (private.is_workspace_member(workspace_id));
create policy "members insert placement_tests" on public.placement_tests for insert
  to authenticated with check (private.is_workspace_member(workspace_id));
create policy "members update placement_tests" on public.placement_tests for update
  to authenticated using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));
create policy "members delete placement_tests" on public.placement_tests for delete
  to authenticated using (private.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Exclude seed inboxes from health, analytics, and auto-pause. Seeds receive
-- test mail and send nothing, so counting them would skew every metric and a
-- seed could even be "auto-paused" for a bounce rate it can't have.
-- ---------------------------------------------------------------------------

create or replace function public.inbox_health(p_workspace_id uuid)
returns table (
  inbox_id uuid, email text, status text, warmup_status text,
  warmup_started_at timestamptz, daily_cap integer, current_ramp_cap integer,
  pause_reason text, last_error text, last_error_at timestamptz,
  sends_today bigint, sent_7d bigint, bounced_7d bigint, replies_7d bigint
)
language sql stable security invoker set search_path = public
as $$
  select
    i.id, i.email, i.status, i.warmup_status, i.warmup_started_at,
    i.daily_cap, i.current_ramp_cap, i.pause_reason, i.last_error, i.last_error_at,
    count(distinct e.id) filter (where e.sent_at >= date_trunc('day', now())) as sends_today,
    count(distinct e.id) filter (where e.sent_at >= now() - interval '7 days') as sent_7d,
    count(distinct e.id) filter (where e.bounced and e.sent_at >= now() - interval '7 days') as bounced_7d,
    count(distinct r.id) filter (where r.received_at >= now() - interval '7 days') as replies_7d
  from public.inboxes i
  left join public.emails e on e.inbox_id = i.id and e.workspace_id = p_workspace_id
  left join public.replies r on r.email_id = e.id and r.workspace_id = p_workspace_id
  where i.workspace_id = p_workspace_id and i.is_seed = false
  group by i.id
  order by i.email;
$$;

create or replace function public.evaluate_deliverability(
  p_min_volume integer default 20,
  p_inbox_threshold numeric default 0.03,
  p_domain_threshold numeric default 0.05
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_paused jsonb := '[]'::jsonb;
  rec record;
begin
  for rec in
    select i.id, i.workspace_id, i.email, s.sent_7d, s.bounced_7d,
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
    where i.status = 'active' and i.is_seed = false
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
        'sent_7d', rec.sent_7d, 'bounced_7d', rec.bounced_7d);
    end if;
  end loop;

  for rec in
    select d.id, d.workspace_id, d.domain, s.sent_7d, s.bounced_7d,
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
      where i.domain_id = d.id and i.is_seed = false
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
        'sent_7d', rec.sent_7d, 'bounced_7d', rec.bounced_7d);
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
