# Sending Engine Setup (Phase 2)

Everything the code needs is built; these are the one-time manual steps to make
real sending work. None of it should be done before the domain-aging clock
from Phase 0 has run (no real sends before day 10-14).

## 1. Environment variables

Set these (see `.env.example` for the full list):

| Var | What | How |
|---|---|---|
| `SUPABASE_SECRET_KEY` | service-role key for the worker | Supabase → Project Settings → API |
| `APP_URL` | absolute app URL for unsubscribe/tracking links | e.g. `https://app.getfoxstays.com` |
| `TOKEN_ENCRYPTION_KEY` | AES key for Gmail refresh tokens | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `CRON_SECRET` | shared secret for `/api/cron/*` | `openssl rand -hex 32` |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | Gmail OAuth app | step 2 below |

`APP_URL` is mandatory for sending — the worker refuses to send without it
rather than ship mail with a broken unsubscribe footer.

**Also required before sending:** each workspace must have a **physical mailing
address** set (Onboarding, or the workspace settings). CAN-SPAM requires it in
every footer, so the worker hard-stops any send from a workspace with no
address rather than mail a non-compliant message.

## 2. Google OAuth app (internal — no Google review)

1. Google Cloud Console → create/select a project on your Workspace org.
2. APIs & Services → **Enable** the Gmail API.
3. OAuth consent screen → User type **Internal** (this keeps you out of
   Google's verification/review — Section 9.4). Add scopes:
   `.../auth/gmail.send`, `.../auth/gmail.readonly`, `openid`, `userinfo.email`.
4. Credentials → Create **OAuth client ID** → Web application.
   - Authorized redirect URI: `<APP_URL>/api/oauth/google/callback`
   - (add the localhost variant too for dev: `http://localhost:3000/api/oauth/google/callback`)
5. Put the client id/secret in `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.

Then in the app: **Settings → Inboxes → Connect an inbox** runs the OAuth
flow and stores the refresh token encrypted. Reconnecting the same mailbox
updates the token.

## 3. Schedule the send-worker with pg_cron

In the Supabase SQL editor (enable the extensions once, then schedule):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'instantal-send-worker',
  '* * * * *',                       -- every minute
  $$
  select net.http_post(
    url     := 'https://APP_URL/api/cron/send-worker',   -- <-- your APP_URL
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_CRON_SECRET',         -- <-- your CRON_SECRET
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

To change or remove it later: `select cron.unschedule('instantal-send-worker');`

**Hardening (optional):** the secret above is visible to project superusers in
`cron.job`. To avoid that, store it in Supabase Vault and read it in the cron
body via `vault.decrypted_secrets` instead of inlining it.

The worker is safe to run every minute even with nothing to do — it claims
due rows atomically (`FOR UPDATE SKIP LOCKED`, so overlapping runs never
double-send) and returns immediately when the queue is empty.

### 3a. Schedule the reply-worker (Phase 4)

The reply-worker polls each connected inbox for new replies + bounce
notifications every 5 minutes, classifies replies with Claude, and drives the
unified inbox / pipeline. It runs on a separate lease (id=2) so it never blocks
the send-worker.

```sql
select cron.schedule(
  'instantal-reply-worker',
  '*/5 * * * *',                     -- every 5 minutes
  $$
  select net.http_post(
    url     := 'https://APP_URL/api/cron/poll-replies',  -- <-- your APP_URL
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_CRON_SECRET',         -- <-- your CRON_SECRET
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

Requires `ANTHROPIC_API_KEY` set (reply classification). Tune the classifier
model with `ANTHROPIC_CLASSIFY_MODEL` (default `claude-haiku-4-5`) and the
out-of-office auto-resume delay with `OOO_RESUME_DELAY_DAYS` (default `3`).
Remove later with `select cron.unschedule('instantal-reply-worker');`.

## 4. Bring an inbox online

Per inbox, in **Settings → Inboxes**:

1. **Connect** (OAuth) — status starts `paused`.
2. **Start warmup** — starts the ramp clock. Volume is 0 until day 10, then
   ramps automatically (10 → 15 → 30 → your daily cap) per Section 9.2. The
   code enforces this; you can't push past it.
3. **Activate** — the worker will now send from this inbox, within the ramp
   cap and a randomized 4-12 min gap between sends.

## 5. Tracking subdomain (optional)

Open tracking is OFF by default (Section 5.5). If you enable it per-campaign
later, the pixel and click links are served from `<APP_URL>/api/track/*`. Point
the `t.` CNAME at the app per `docs/DNS-SETUP.md` if you want tracking on the
sending subdomain rather than the app host.

## What the engine does per tick

1. Atomically claims due `send_queue` rows (no double-send).
2. Per inbox: checks ramp cap, today's count, and the send gap; sends at most
   one message, deferring the rest.
3. Renders the step (merge tags, spintax), injects the unsubscribe footer +
   your workspace's physical address, sends via the Gmail API.
4. Records the email + a send event, threads follow-ups (In-Reply-To /
   References), and schedules the next step.
5. Hard bounces / replies / unsubscribes are handled by triggers + the
   reply-worker (Phase 4): a reply stops the sequence and is classified into the
   unified inbox; an out-of-office auto-resumes after `OOO_RESUME_DELAY_DAYS`; a
   hard bounce suppresses the address globally and increments the domain counter.
