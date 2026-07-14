# Outreach Platform + CRM - Complete Build Plan

Self-hosted cold email platform replacing Instantly. Built on the existing stack: Next.js (App Router) + TypeScript + Tailwind + shadcn + Supabase (Postgres, RLS, Auth) + Vercel. Claude API for reply classification and personalization.

Target volume: 1,000 to 10,000 cold emails per month.

---

## 1. Decisions + Remaining Assumptions

1. CONFIRMED: Standalone new app in its own repo. Webhook sync into the foxstays CRM is Phase 6.
2. CONFIRMED: Multi-workspace from day 1: one workspace per venture (FoxStays, Seatop, Octo). Same codebase, isolated data.
3. DECIDED: Natural ramp is the primary reputation strategy - real sends to verified, high-relevance leads on a coded ramp schedule. A large-network warmup tool (SMTP/IMAP based, never Gmail API) is optional insurance for weeks 1-3 only. See Section 9.
4. Google Workspace inboxes, sending through the Gmail API (not raw SMTP).
5. Leads arrive by CSV import and manual add in v1. Scraper/enrichment integration is Phase 6.
6. Resend stays for transactional email only. Cold outreach never touches it.

---

## 2. Sending Infrastructure Sizing (read this first)

Cold email safe limit is 20 to 50 emails per inbox per day, max 2 to 3 inboxes per domain. This math drives everything:

| Monthly volume | Daily (22 biz days) | Inboxes @ 40/day | Domains |
|---|---|---|---|
| 1,000 | ~45 | 2 | 1-2 |
| 3,000 | ~135 | 4 | 2 |
| 5,000 | ~225 | 6 | 2-3 |
| 10,000 | ~455 | 12 | 4-5 |

**Start config:** 2 domains, 4 inboxes total, ~160/day ceiling after full warmup. Scale by adding domain+inbox pairs, never by pushing existing inboxes harder.

Domain rules:
- Never send cold email from foxstays.com, seatophomes.com, or any revenue domain.
- Buy close variants: getfoxstays.com, foxstays.co, tryseatop.com, etc.
- Each sending domain gets its own tracking subdomain (e.g. t.getfoxstays.com) via CNAME.
- Redirect each sending domain's root to the real site (trust signal).

---

## 3. System Architecture

```
Next.js app (Vercel)
  ├─ Dashboard UI (campaigns, leads, inbox, analytics)
  ├─ API routes
  │    ├─ /api/track/open/[id]   -> 1x1 pixel
  │    ├─ /api/track/click/[id]  -> 302 redirect
  │    ├─ /api/unsubscribe/[token]
  │    └─ /api/cron/*            -> workers (protected by CRON_SECRET)
  └─ OAuth connect flow for Gmail inboxes

Supabase
  ├─ Postgres + RLS (workspace_id on every table)
  ├─ Auth (you + Otman/Saar later, role-based)
  ├─ pg_cron -> triggers worker endpoints every minute
  └─ Vault / encrypted columns for OAuth refresh tokens

Workers (API routes hit by cron)
  ├─ send-worker: pulls due rows from send_queue, respects caps, sends via Gmail API
  ├─ reply-worker: polls Gmail for replies + bounces (every 5 min)
  ├─ classify-worker: Claude API classifies new replies
  └─ health-worker: daily bounce-rate, blacklist, DNS checks

External services
  ├─ Gmail API (send + read, OAuth per inbox)
  ├─ Warmup network (third party, per inbox)
  ├─ Email verification API (at import time)
  └─ Claude API (reply classification, optional first-line personalization)
```

Why Gmail API over SMTP: threading control (follow-ups land in the same thread via In-Reply-To/References headers), reply detection in the same channel, no separate SMTP credentials to manage, and Google trusts its own API traffic more.

Queue design: a `send_queue` table in Postgres is the queue. pg_cron pings the send-worker every minute. Worker grabs rows where `scheduled_at <= now()`, groups by inbox, enforces daily cap + minimum gap since that inbox's last send, sends, marks done. At 500/day this is trivial load. No Redis, no external queue needed.

---

## 4. Database Schema (core tables)

All tables carry `workspace_id uuid` + RLS policy. Timestamps everywhere.

```sql
workspaces        (id, name, venture, physical_address, default_timezone)
members           (workspace_id, user_id, role)  -- owner / member
sending_domains   (id, domain, tracking_domain, dns_spf, dns_dkim,
                   dns_dmarc, dns_verified_at, redirect_ok, status)
inboxes           (id, domain_id, email, display_name, provider,
                   oauth_refresh_token_enc, daily_cap, current_ramp_cap,
                   warmup_started_at, warmup_status, health_score,
                   last_send_at, status)  -- active/paused/burned
leads             (id, email, first_name, last_name, company, title,
                   phone, website, custom jsonb, source, verify_status,
                   verify_checked_at, status, owner_stage)
lead_lists        (id, name)
list_members      (list_id, lead_id)
campaigns         (id, name, status, list_id, inbox_ids uuid[],
                   send_window_start, send_window_end, send_days int[],
                   timezone_mode,   -- lead tz or fixed
                   track_opens bool, track_clicks bool,
                   daily_limit, stop_on_reply bool)
campaign_steps    (id, campaign_id, step_no, delay_days,
                   subject, body_html, body_text,
                   variant_group)   -- A/B variants share step_no
campaign_leads    (campaign_id, lead_id, current_step, status,
                   -- queued/active/replied/bounced/unsubscribed/finished
                   next_send_at, thread_id, last_message_id)
send_queue        (id, campaign_id, lead_id, step_id, inbox_id,
                   scheduled_at, status, attempts, error)
emails            (id, campaign_id, lead_id, step_id, inbox_id,
                   gmail_message_id, gmail_thread_id, subject,
                   sent_at, opened_at, first_click_at,
                   bounced bool, bounce_type)
events            (id, email_id, type, ts, meta jsonb)
                   -- open/click/reply/bounce/unsub
replies           (id, email_id, lead_id, gmail_message_id, body_text,
                   received_at, classification, confidence, handled bool)
                   -- interested / not_interested / ooo / referral /
                   -- unsubscribe_request / bounce / other
suppression       (email, reason, workspace_id nullable,
                   -- null = global across all ventures
                   created_at)
unsub_tokens      (token, lead_id, campaign_id)
health_checks     (id, domain_id, check_type, result jsonb, checked_at)
```

Key constraints:
- Unique (workspace_id, email) on leads. Import dedupes on this.
- Trigger: insert into suppression -> cancel all pending send_queue rows for that email, everywhere.
- Trigger: reply recorded + stop_on_reply -> set campaign_leads.status = replied, delete pending queue rows.

---

## 5. Core Modules Spec

### 5.1 CRM

- Leads table view: filter by list, status, campaign, tag. Bulk actions.
- Lead detail: full timeline (every send, open, click, reply), notes, stage.
- Pipeline stages: New -> Contacted -> Replied -> Interested -> Meeting -> Client -> Lost. Kanban view.
- CSV import wizard: column mapping, dedupe against existing + suppression, auto-queue verification, import report (accepted / dupes / invalid / suppressed).
- Email verification on import. Reject undeliverables. Never send to unverified leads - this single rule protects your domains more than anything else.

### 5.2 Campaign Engine

- Sequence builder: steps with day-delays, per-step A/B variants (subject and/or body), plain-text-first editor.
- Merge tags: {{first_name}}, {{company}}, {{custom.x}}, with fallback values. Preview against a real lead before launch.
- Spintax support: {Hi|Hey|Hello} for pattern variance.
- Scheduling: business hours in lead timezone (or fixed tz), selected weekdays only, randomized 4 to 12 minute gaps per inbox, daily caps per inbox and per campaign.
- Follow-ups send in the same Gmail thread (In-Reply-To + References headers, subject "Re: ...").
- Launch checklist gate: DNS verified, domain age >= 14 days, ramp caps active, list verified, unsubscribe link present, physical address present. Cannot launch without all green.

### 5.3 Sending Worker

- Every minute: fetch due queue rows, group by inbox, check ramp cap + gap, render template, inject tracking (if enabled) + unsubscribe footer, send via Gmail API, store message/thread ids, schedule the lead's next step.
- Hard-fail handling: 2 retries with backoff, then mark error and alert.
- Ramp automation: current_ramp_cap follows the schedule in Section 9 automatically based on warmup_started_at.

### 5.4 Reply Handling + Unified Inbox

- Poll each inbox every 5 min for new messages in tracked threads + bounce notifications (mailer-daemon parsing for hard vs soft bounce).
- Hard bounce -> suppress globally + increment domain bounce counter.
- New reply -> stop sequence -> Claude API classifies -> lands in Unified Inbox filtered by classification.
- "Interested" auto-moves lead to Interested stage. You reply from inside the app (Gmail API send in-thread) or open in Gmail.
- OOO detection -> auto-resume sequence after a set delay instead of stopping.

### 5.5 Deliverability Ops

- Inbox health dashboard: sends today/cap, bounce rate (7d), reply rate, warmup status, last error.
- Auto-pause rules: inbox bounce rate > 3% (7d) -> pause inbox. Domain bounce > 5% -> pause domain, alert.
- Daily health-worker: DNS still valid (SPF/DKIM/DMARC), blacklist spot checks, tracking domain resolving.
- Open tracking is OFF by default. The pixel + custom domain slightly hurts inbox placement and open data is unreliable now anyway. Reply rate is the metric that matters. Enable per-campaign only when you truly need it.

### 5.6 Analytics

- Per campaign: sent, delivered, bounced, replies, positive replies, positive reply rate per variant (the number that decides A/B winners).
- Per inbox and per domain trends.
- Workspace rollup across ventures.

---

## 6. Compliance (built in, not optional)

US B2B cold email is legal under CAN-SPAM if:
- No deceptive subject lines or headers.
- Working unsubscribe honored within 10 days (ours is instant + one-click List-Unsubscribe header).
- Valid physical mailing address in the footer (per workspace setting).
- Suppression respected forever, globally across ventures.

For any EU/Canada leads later: stricter rules (GDPR legitimate interest, CASL). v1 targets US leads; add a country field so this is enforceable later.

---

## 7. Build Phases

Total: 5 to 6 weeks part time with Claude Code. Domain aging + ramp runs in parallel: first small real sends around day 10-14, full per-inbox volume by week 5-6. Start Phase 0 today for that reason.

### Phase 0 - Infrastructure + Foundations (Days 1-3) <- calendar-critical

- Buy 2 domains, create 4 Google Workspace inboxes ($7/user/mo each).
- SPF, DKIM, DMARC (p=quarantine), tracking CNAMEs, root redirects. Claude Code generates the exact DNS records; you paste into the registrar.
- Set up Google Postmaster Tools for every sending domain. This is the real reputation scoreboard.
- **Domain aging clock starts today.** No real sends before day 10-14. This clock is why Phase 0 cannot wait for code.
- Optional: enroll inboxes in a large-network warmup tool (SMTP/IMAP connection only) as weeks 1-3 insurance.
- Repo init, Supabase project, Auth, workspaces + members + RLS baseline, shadcn setup.
- **Done when:** DNS checks green, Postmaster Tools verified, domains aging, you can log in and see an empty dashboard.

### Phase 1 - CRM Core (Week 1-2)

- Full schema migration. Leads CRUD, lists, tags, custom fields.
- CSV import wizard with dedupe + verification API + import report.
- Lead detail page with timeline scaffold. Suppression list + global enforcement trigger.
- **Done when:** you import a real 500-lead CSV and get a clean, verified, deduped list.

### Phase 2 - Sending Engine (Week 2-3)

- Gmail OAuth connect flow, encrypted token storage, inbox management UI.
- send_queue + pg_cron + send-worker with rotation, caps, gaps, ramp automation.
- Unsubscribe endpoint + footer injection. Tracking endpoints (behind per-campaign flag).
- Test campaign to 20 internal/test addresses.
- Meanwhile, start manual sends: 5-15/day per inbox by hand to your warmest verified leads. Real human sends are the strongest reputation signal there is.
- **Done when:** a 3-step test sequence delivers to your own inboxes, threaded correctly, caps respected.

### Phase 3 - Campaign Builder (Week 3-4)

- Sequence builder UI, variants, merge tags + preview, spintax.
- Send windows, timezone handling, launch checklist gate, pause/resume/duplicate.
- **Done when:** you build and launch a full campaign start-to-finish without touching the database.

### Phase 4 - Replies + Unified Inbox (Week 4-5)

- Reply/bounce polling, stop-on-reply, hard-bounce suppression.
- Claude classification, unified inbox, in-thread reply from app, OOO auto-resume.
- Pipeline kanban wired to classifications.
- **First full platform campaign launches this week** at 25-35/day/inbox (ramp week 4), best verified segments first.
- **Done when:** a real prospect reply appears classified in the inbox and the sequence stopped itself.

### Phase 5 - Deliverability Ops + Analytics (Week 5-6)

- Health dashboard, auto-pause rules, daily health-worker, alerting (email or Slack webhook).
- Campaign/variant analytics, workspace rollups.
- **Done when:** you can answer "which variant wins and are my domains healthy" from one screen.

### Phase 6 - Later (post-launch backlog)

- Scraper/enrichment pipeline feeding leads directly (AYCA-style flows).
- AI first-line personalization at scale with review queue.
- Webhook sync to foxstays CRM (HMAC, same pattern as your Partner API).
- Team roles for Otman/Saar, per-workspace permissions.
- LinkedIn/manual task steps in sequences. Deeper A/B stats.

---

## 8. Cost Model (steady state)

| Item | Monthly |
|---|---|
| Google Workspace, 4 inboxes | ~$28 |
| Domains (2 to 5) | ~$3 amortized |
| Warmup tool (optional, weeks 1-3) | $0 to 30 |
| Verification API (pay per verify) | ~$5 to 25 |
| Claude API (classification) | ~$2 to 10 |
| Supabase + Vercel | existing plans |
| **Total at 1-5k/mo volume** | **~$40 to 95** |

At 10k/month you need ~12 inboxes, so Workspace alone is ~$84/mo. Still cheaper than tools at that tier, and you own the asset + CRM. Compare against your current Instantly bill for the real delta.

---

## 9. Risks + Honest Caveats

1. **Warmup tools in 2026: degraded, optional.** Google killed GMass warmup in 2023, tightened bulk sender rules in Feb 2024, and by late 2025 rejects non-compliant mail at the SMTP level; Microsoft followed in May 2025. Google's ML detects and discounts bot engagement from warmup pools, and independent tests show little measurable lift. Large-network SMTP/IMAP tools still add modest early insurance; cheap small-pool tools are worse than nothing (detectable pattern). Never DIY-warm by having your own 4 inboxes email each other - a closed loop is the most detectable pattern of all. Reputation truth lives in Google Postmaster Tools, not warmup dashboards. What actually builds reputation: perfect auth, verified lists under 2% bounce, the ramp below, and genuine replies.
2. **Ramp discipline.** Days 1-10: domain ages, zero sends. Weeks 2-3: 5-15/day per inbox, manual, warmest verified leads only. Week 4: 25-35 via platform. Week 5+: cap at 40-50. The ramp automation enforces this so you can't get impatient.
3. **A burned domain stays burned** for months. That's why: variant domains only, verification mandatory, auto-pause at 3% bounce.
4. **Gmail OAuth app verification.** An internal-use OAuth app on your own Workspace avoids Google's app review. Keep it internal.
5. **Maintenance tax:** ~30 min/week checking health dashboard once alerts exist. Not zero. Budget it.

---

## 10. Open Questions

1. Who else needs access in v1: just you, or Otman/Saar immediately?
2. Any existing Instantly campaign data/leads to migrate at kickoff?

---

## 11. Running This With Claude Code

Drop this file in the repo root as the master spec. Then per phase, open the Code tab and prompt: "Read OUTREACH-BUILD-PLAN.md. Implement Phase N only. Follow the schema in Section 4 exactly. Ask before deviating." Keep DESIGN.md alongside it for UI standards, same as your other projects. One phase per session keeps context tight and output quality high.
