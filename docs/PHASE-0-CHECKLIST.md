# Phase 0 Checklist — Infrastructure + Foundations

Phase 0 is calendar-critical because the **domain aging clock** only starts
when domains exist with live DNS. Do the manual steps first; the code half is
already in this repo.

## Manual (do today)

- [ ] Buy 2 sending domains — close variants of the real brands
      (e.g. `getfoxstays.com`, `tryseatop.com`). Never revenue domains.
- [ ] Add both domains to Google Workspace, create 4 inboxes total
      (2 per domain, ~$7/user/mo each). Real human names, photos, signatures.
- [ ] Publish DNS per `docs/DNS-SETUP.md`: SPF, DKIM (2048), DMARC
      (`p=quarantine`), tracking CNAME, root redirect. Verify with the dig
      commands in that file.
- [ ] Verify every sending domain in Google Postmaster Tools.
- [ ] (Optional) Enroll the 4 inboxes in a large-network warmup tool —
      SMTP/IMAP connection only, never Gmail API access. Weeks 1-3 insurance
      only; see plan §9.1 before paying for anything.
- [ ] Calendar reminder: first manual sends (5-15/day/inbox, warmest verified
      leads) no earlier than **day 10-14** after DNS goes live.
- [ ] Export everything from Instantly while the subscription is active:
      blocklist/unsubscribes, per-campaign leads with status, analytics,
      sequence copy. Imports happen in Phase 1; exports cannot wait —
      see `docs/INSTANTLY-MIGRATION.md`.

## Supabase project (once)

- [ ] Create a Supabase project (region close to you).
- [ ] Run the migration: either `supabase link --project-ref <ref> && supabase db push`
      with the CLI, or paste
      `supabase/migrations/20260713000001_phase0_foundations.sql` into the
      SQL editor.
- [ ] Auth → Providers: leave **Email** enabled; turn **off** "Allow new users
      to sign up" (this app has no self-serve signup — users are created by
      an admin).
- [ ] Auth → Users → **Add user** → create your own user with a password
      (check "Auto confirm").
- [ ] Same for Otman and Saar (v1 access is confirmed). After you create
      your workspaces in the app, add them as members in the SQL editor —
      there is no member-management UI until Phase 6:

      ```sql
      insert into public.members (workspace_id, user_id, role)
      select w.id, u.id, 'member'
      from public.workspaces w
      cross join auth.users u
      where u.email in ('otman@...', 'saar@...');
      ```

## Vercel + app (once)

- [ ] Copy `.env.example` → `.env.local`, fill the two `NEXT_PUBLIC_SUPABASE_*`
      values from Project Settings → API.
- [ ] `npm install && npm run dev`, sign in, create the FoxStays / Seatop /
      Octo workspaces from the onboarding screen + workspace switcher.
- [ ] Import the repo into Vercel, set the same env vars, deploy.

## Done when

- DNS checks green on both domains, Postmaster Tools verified.
- Domains aging (clock started, dated in your calendar).
- You can log in and see the empty dashboard per workspace.
