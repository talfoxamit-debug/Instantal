# Instantly → Instantal Migration

Two rules drive everything here:

1. **Export now, while the Instantly subscription is active.** Once it lapses
   you lose the data. Exports keep; do them today even though imports wait
   for Phase 1.
2. **Suppression imports before leads, always.** Anyone who unsubscribed or
   bounced in Instantly must be in the `suppression` table before the first
   lead row lands. CAN-SPAM opt-outs survive tool switches; a re-mailed
   unsubscribe is both illegal and a spam-report generator.

## Step 1 — Export from Instantly (do today)

Per workspace/venture in Instantly:

- [ ] **Block list / unsubscribes**: Settings → Blocklist (and any
      campaign-level unsubscribe lists) → export CSV. This is the critical one.
- [ ] **Leads**: per campaign, export leads CSV — make sure the export
      includes status columns (contacted / replied / bounced / unsubscribed /
      interested) and any custom variables used in templates.
- [ ] **Campaign analytics**: per campaign, export or screenshot the
      sent/reply/bounce numbers per variant. Not imported anywhere — kept as
      the baseline your new campaigns must beat.
- [ ] **Copy**: save the sequence copy (subjects + bodies + variants) of
      anything still running or worth reusing. Paste into a doc or the repo.
- [ ] Note each campaign's sending schedule and which inboxes it used, if
      you plan to continue any sequence rather than restart it.

Park all exports in one folder (e.g. Drive `instantly-export-2026-07/`),
one subfolder per venture.

## Step 2 — Import into Instantal (Phase 1, in this order)

1. **Suppression**: import every blocklist/unsubscribe CSV into
   `suppression` with `workspace_id = null` (global — an opt-out from one
   venture is honored across all of them) and `reason = 'instantly_import'`.
2. **Leads**: import lead CSVs through the Phase 1 import wizard,
   `source = 'instantly'`. The wizard dedupes against suppression, so order
   makes this automatic. Map Instantly statuses:
   - replied / interested → matching pipeline stage, excluded from cold sequences
   - bounced → do not import as sendable; add to suppression (hard bounce)
   - contacted (no reply) → `owner_stage = Contacted`; only re-enter
     sequences deliberately, in a re-engagement campaign, never the same cold opener
3. **Verification**: all imported leads go through the verification API like
   any other import. Instantly-era verification is stale; do not trust it.

## What does NOT migrate

- Inbox/domain reputation — that lives with the domains and warms on the new
  sending domains per the ramp in plan §9.
- Open/click history, thread contents. If a thread is genuinely live, finish
  it by hand in Gmail.
