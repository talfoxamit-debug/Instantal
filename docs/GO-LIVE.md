# Go-Live Runbook

The single ordered path from an empty Supabase project to a running Instantal you
can log into and use. Every code phase (0–5) is built; this is the infra + config
that only you can do (accounts, domains, DNS, OAuth). Budget **~1–2 hours** of
setup for the app to be **usable today**, then read [§ The honest
timeline](#the-honest-timeline) for what can actually *send cold email* and when.

Do the steps in order — later steps depend on earlier ones.

---

## 0. Accounts you need

- **Supabase** project (Postgres + Auth). Free tier is fine to start.
- **Vercel** account (hosting). Hobby works; Pro only if you want Vercel Cron
  instead of Supabase pg_cron (see § 7).
- **Google Workspace** admin on the domain(s) you'll send from — to stand up the
  internal OAuth app.
- **Sending domains** — new domains, *never* the revenue domains
  (foxstays.com, seatophomes.com). Buy these first if you haven't; DNS/warmup is
  the long pole.
- **Anthropic API key** (reply classification) — you have one.
- An **email-verification vendor** account (see § 9).

---

## 1. Supabase project + schema

1. Create the project. Note the **Project URL** and, under *Project Settings →
   API keys*, the **publishable** key and the **secret** (service-role) key.
2. Apply the six migrations in `supabase/migrations/` **in filename order**.
   Either:
   - **Supabase CLI:** `supabase link --project-ref <ref>` then
     `supabase db push`, **or**
   - **SQL editor:** paste each `supabase/migrations/2026*.sql` file in order and
     run it.
3. Sanity check: the `public` schema should now have `workspaces`, `leads`,
   `campaigns`, `send_queue`, `emails`, `replies`, `suppression`, etc., all with
   RLS enabled.

---

## 2. Environment variables

Copy `.env.example` and fill it in. The **must-have-to-boot-and-log-in** set:

| Var | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
| `SUPABASE_SECRET_KEY` | Supabase **secret/service-role** key (server only) |
| `APP_URL` | your deployed URL, e.g. `https://app.yourdomain.com` |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` (encrypts Gmail tokens) |
| `CRON_SECRET` | `openssl rand -hex 32` (protects the worker routes) |

Needed **before sending / replies** (can add later): `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET` (§ 5), `ANTHROPIC_API_KEY`,
`EMAIL_VERIFICATION_API_URL` + `EMAIL_VERIFICATION_API_KEY` (§ 9). Optional:
`OAUTH_STATE_SECRET` (falls back to `CRON_SECRET`), `ANTHROPIC_CLASSIFY_MODEL`,
`OOO_RESUME_DELAY_DAYS`, `SLACK_ALERT_WEBHOOK_URL`.

Set the same vars in Vercel (*Project → Settings → Environment Variables*).

---

## 3. Deploy to Vercel

1. Connect the repo, deploy the `claude/outreach-crm-build-plan-x9xsr0` branch
   (or merge it to `main` first).
2. Confirm the build succeeds and the site loads at your `APP_URL`. The `/login`
   page should render.
3. Point `APP_URL` at the real deployed URL and redeploy if it changed.

---

## 4. Create your admin user and log in

There is **no self-serve signup** (by design). Create your login with the
service-role key:

```bash
# with the app env available locally (or run in any node env with the two vars set):
export NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=...
npm run create-user -- you@yourdomain.com 'a-strong-password'
# omit the password to have a strong one generated and printed once
```

Then: open `/login`, sign in → you land on `/onboarding` → create your first
**workspace** (one per venture; add the others later via the workspace switcher).
You now have a usable CRM: **Leads**, **Campaigns**, **Inbox**, **Pipeline**,
**Analytics**, **Settings** are all live.

---

## 5. Google OAuth (Gmail sending + reply polling)

Follow `docs/SENDING-SETUP.md` § "Google OAuth app". In short:

1. In Google Cloud (on your Workspace org), create an **Internal** OAuth app —
   internal keeps you out of Google's verification queue.
2. Enable the **Gmail API**.
3. Add the redirect URI: `https://<APP_URL>/api/oauth/google/callback`.
4. Put the client id/secret into `GOOGLE_OAUTH_CLIENT_ID` /
   `GOOGLE_OAUTH_CLIENT_SECRET` and redeploy.

---

## 6. Sending domains + DNS

Follow `docs/DNS-SETUP.md` for each sending domain:

1. Buy new domains (variant domains, not the revenue ones).
2. Set **SPF**, **DKIM** (`google` selector), **DMARC** TXT records.
3. In **Settings → Domains**, add the domain and mark DNS verified once the
   records resolve. The launch checklist enforces SPF+DKIM+DMARC and a domain age
   ≥ 14 days before a campaign can start.

---

## 7. Schedule the workers

Three background workers must run on a schedule. **Pick one** mechanism:

- **Supabase pg_cron** (recommended, works on any Vercel plan) — run the SQL in
  `docs/SENDING-SETUP.md` §§ 3, 3a, 3b to schedule:
  - `send-worker` every minute, `reply-worker` every 5 min, `health-worker`
    daily. Each posts to `https://<APP_URL>/api/cron/<worker>` with your
    `CRON_SECRET`.
- **Vercel Cron** (needs **Pro** for the sub-daily schedules) — copy
  `docs/vercel-cron.example.json` to `./vercel.json` and redeploy. Vercel auto-
  sends `Authorization: Bearer $CRON_SECRET`; the routes accept GET for this.

Verify: `curl -H "Authorization: Bearer $CRON_SECRET" https://<APP_URL>/api/cron/send-worker`
should return `{"ok":true,...}`.

---

## 8. Connect inboxes + start warmup

Per sending mailbox, in **Settings → Inboxes**:

1. **Connect** (Google OAuth) — status starts `paused`.
2. **Start warmup** — starts the ramp clock (volume is 0 until day 10, then
   ramps automatically; the code enforces it — you can't push past it).
3. **Activate** — the send-worker will now send from it, within the ramp cap and
   a randomized 4–12 min gap.

---

## 9. Email verification vendor

Cold sending requires verified leads (the launch checklist blocks otherwise).
Pick a vendor (e.g. ZeroBounce, NeverBounce, MillionVerifier), set
`EMAIL_VERIFICATION_API_URL` + `EMAIL_VERIFICATION_API_KEY`, and confirm the
response mapping in `lib/verification/index.ts` matches the vendor's vocabulary
before verifying at scale.

---

## 10. Import your Instantly data

Per `docs/INSTANTLY-MIGRATION.md`, and **in this order**:

1. **Suppression list first** — import every unsubscribe/bounce into
   **Leads → Suppression** so you can never re-mail an opt-out. This is a
   compliance must and must precede any lead import.
2. **Then leads** — **Leads → Import CSV**. Dedupe is automatic on
   (workspace, email); suppressed addresses are held out of sends.

---

## 11. Add your teammates

Create logins for Otman and Saar, then add them to the workspace(s):

```bash
npm run create-user -- otman@yourdomain.com
npm run create-user -- saar@yourdomain.com
```

Add them as members of the relevant workspace(s) (owner-managed; a membership row
per workspace). They sign in and see exactly that workspace's data (RLS-isolated).

---

## The honest timeline

**Usable today (≈1–2h of the above):** log in, manage leads, import Instantly
data, build campaigns and sequences, connect inboxes, watch the unified inbox and
analytics. The *product* is done and working.

**Actually sending cold email at volume — not tomorrow, and that's not a code
limit:** the platform deliberately enforces deliverability reality (Section 9 of
the build plan):

- A brand-new sending domain must **age ≥ 14 days** before a campaign can launch
  (the launch checklist blocks it).
- Warmup ramps volume from **0 (days 1–9) → 10 → 15 → 30 → your cap** over the
  first month. This protects the domain's reputation; a burned domain stays
  burned for months.

So: stand everything up today, connect inboxes and **start warmup today** — the
clock only runs once warmup starts. Real cold-send volume is **~2–4 weeks out**,
gated by warmup, not by anything left to build. If you have **already-warmed**
domains/inboxes, you can move faster — connect them, mark DNS verified, and the
checklist will let you launch as soon as the age/ramp thresholds are met.

If you need to email *today*, do it as 1:1 replies from the **Inbox** (warmup
doesn't gate in-thread replies), not as a cold sequence.
