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
| 1 | CRM core (leads, CSV import, verification, suppression, Instantly migration) | ✅ done |
| 2 | Sending engine (Gmail OAuth, send_queue, workers, ramp, unsubscribe/tracking) | ✅ done |
| 3 | Campaign builder (sequences, variants, scheduling, launch gate) | ✅ done |
| 4 | Replies + unified inbox (classification, stop-on-reply, pipeline) | ✅ done |
| 5 | Deliverability ops + analytics (auto-pause, health-worker, A/B stats) | ✅ done |
| 6 | Backlog (enrichment, CRM webhook sync, team roles) | post-launch |

All product code (Phases 0–5) is built and reviewed. What remains is infra you
provision: Supabase project, domains + DNS, the Google OAuth app, and env/cron.

## Getting started → **[`docs/GO-LIVE.md`](./docs/GO-LIVE.md)**

The full ordered runbook (Supabase → env → deploy → first login → sending infra →
workers → imports) lives in [`docs/GO-LIVE.md`](./docs/GO-LIVE.md). The short
version:

1. **Supabase**: create a project; apply all migrations in `supabase/migrations/`
   in order (`supabase db push`, or paste each into the SQL editor).
2. **Env**: `cp .env.example .env.local`; fill in Supabase URL + keys, `APP_URL`,
   `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`), `CRON_SECRET`
   (`openssl rand -hex 32`).
3. **Deploy** to Vercel (set the same env vars there).
4. **Create your login** (no self-serve signup):
   `npm run create-user -- you@yourdomain.com` → sign in at `/login` → create a
   workspace on `/onboarding`.
5. **Sending infra**: Google OAuth app + domains/DNS + schedule the workers —
   [`docs/GO-LIVE.md`](./docs/GO-LIVE.md) §§ 5–8. Cold-send volume is gated by
   domain **warmup** (~2–4 weeks), not by remaining code.

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
