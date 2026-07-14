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
| 1 | CRM core (leads, CSV import, verification, suppression) | ⬜ |
| 2 | Sending engine (Gmail OAuth, send_queue, workers, ramp) | ⬜ |
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
    dashboard/      empty dashboard (Phase 0 done-when)
    workspaces/new/ add the other venture workspaces
components/         app shell + shadcn/ui primitives
lib/
  supabase/         browser/server/proxy clients (@supabase/ssr)
  auth/             sign-in/sign-out server actions
  workspaces/       membership queries + workspace server actions
proxy.ts            session refresh + route protection (Next 16 proxy)
supabase/
  migrations/       SQL migrations (workspaces, members, RLS baseline)
docs/               DNS records + Phase 0 ops checklist
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
