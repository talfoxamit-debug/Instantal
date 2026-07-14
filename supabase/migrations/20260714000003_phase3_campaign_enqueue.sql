-- Phase 3: make campaign enqueue idempotent.
--
-- A lead receives each campaign step at most once, so there must be at most one
-- send_queue row per (campaign, lead, step). Without this, two concurrent
-- launches (double-clicked button, retried POST, two admins) each insert a full
-- set of step-1 rows — the worker then dispatches the same first email twice
-- (it sends before recording in `emails`, so the emails unique key can't block
-- the second dispatch). This unique index makes the enqueue insert an
-- idempotent ON CONFLICT DO NOTHING; advanceSequence enqueues the NEXT step
-- (a different step_id), so legitimate sequencing is unaffected.
create unique index send_queue_campaign_lead_step_key
  on public.send_queue (campaign_id, lead_id, step_id);
