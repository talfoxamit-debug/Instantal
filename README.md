# Instantal

Self-hosted cold outreach platform + CRM, replacing Instantly. Multi-workspace
(one per venture: FoxStays, Seatop, Octo), Gmail API sending, Supabase
Postgres with RLS, Claude API for reply classification.

**Master spec:** [`OUTREACH-BUILD-PLAN.md`](./OUTREACH-BUILD-PLAN.md) — read it
before building anything.

## Stack

Next.js (App Router) · TypeScript · Tailwind 4 · shadcn/ui · Supabase
(Postgres, RLS, Auth) · Vercel · Claude API

## Status

| Phase | Scope | Status |
|---|---|---|
| 0 | Infra + foundations (auth, workspaces, RLS, dashboard shell) | ✅ code done — manual infra steps in [`docs/PHASE-0-CHECKLIST.md`](./docs/PHASE-0-CHECKLIST.md) |
| 1 | CRM core (leads, CSV import, verification, suppression, Instantly migration) | ✅ code done — pick a verification vendor (`.env`), then import |
| 2 | Sending engine (Gmail OAuth, send_queue, workers, ramp, unsubscribe/tracking) | ✅ code done — Google OAuth app + pg_cron setup in `docs/SENDING-SETUP.md` |
| 3 | Campaign builder (sequences, variants, scheduling, launch gate) | ⬜ |
| 4 | Replies + unified inbox (classification, stop-on-reply) | ⬜ |
| 5 | Deliverability ops + analytics | ⬜ |
| 6 | Backlog (enrichment, CRM webhook sync, team roles) | ⬜ |

## Getting started

1. **Supabase**: create a project, then apply
   [`supabase/migrations/20260713000001_phase0_foundations.sql`](./supabase/migrations/20260713000001_phase0_foundations.sql)
   (CLI: `supabase link && supabase db push`, or paste into the SQL editor).
2. **Auth**: in Supabase Auth settings disable self-serve signup, then create
   your user (Auth → Users → Add user, auto-confirm). This app intentionally
   has no public signup.
3. **Env**: `cp .env.example .env.local` and fill in the Supabase URL +
   publishable key.
4. **Run**: `npm install && npm run dev` → sign in → the onboarding screen
   creates your first workspace (installs you as owner via the
   `create_workspace` RPC).
5. **Sending infra** (calendar-critical, do in parallel):
   [`docs/PHASE-0-CHECKLIST.md`](./docs/PHASE-0-CHECKLIST.md) and
   [`docs/DNS-SETUP.md`](./docs/DNS-SETUP.md).

## Layout

```
app/
  login/            email+password sign-in (no self-serve signup)
  auth/             callback + confirm routes (PKCE / email links)
  onboarding/       first-workspace creation
  (app)/            authenticated shell: sidebar, workspace switcher
    dashboard/      live counts (leads, verified, suppression)
    leads/          CRM: table+filters, detail, lists, import, suppression
    workspaces/new/ add the other venture workspaces
components/
  leads/            CRM client components (table, filters, import wizard, …)
  ui/               shadcn/ui primitives
lib/
  supabase/         browser/server/proxy clients (@supabase/ssr)
  auth/             sign-in/sign-out server actions
  workspaces/       membership queries + workspace server actions
  leads/            lead + list data queries and server actions
  suppression/      suppression data queries and server actions
  import/           pure CSV parse + dedup/classify logic
  verification/     provider-agnostic email verification adapter
  inboxes/          inbox + sending-domain data and actions
  crypto/           AES-256-GCM token encryption + HMAC state signing
  gmail/            OAuth + Gmail API send (MIME, threading)
  sending/          send-worker + pure render/ramp logic
  cron/             cron shared-secret auth
app/api/            cron send-worker, oauth, unsubscribe, tracking routes
proxy.ts            session refresh + route protection (Next 16 proxy)
supabase/
  migrations/       SQL migrations (Phase 0 baseline, Phase 1 schema, Phase 2 sending)
docs/               DNS, Phase 0 checklist, Instantly migration, sending setup
```

## Rules that don't bend

- Cold email never sends from revenue domains, never through Resend.
- No sends to unverified leads. Suppression is global and forever.
- Ramp caps are enforced in code; don't lift them by hand.
- Every table carries `workspace_id` + RLS. New tables copy the pattern in
  the Phase 0 migration.

## Development workflow

Per the plan §11: one phase per Claude Code session —
"Read OUTREACH-BUILD-PLAN.md. Implement Phase N only. Follow the schema in
Section 4 exactly. Ask before deviating."
