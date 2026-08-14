@AGENTS.md

# Project context

- **docs/QUALITY_SYSTEM.md** — fix classes, not instances. Read before fixing or auditing anything.
- Master spec: `OUTREACH-BUILD-PLAN.md` in the repo root. Follow its Section 4
  schema exactly; ask before deviating. Build one phase per session.
- Every database table carries `workspace_id` + an RLS policy. Reuse the
  `private.is_workspace_member` / `private.is_workspace_owner` helpers from
  the Phase 0 migration.
- Cold outreach never sends via Resend and never from revenue domains
  (foxstays.com, seatophomes.com).
- Supabase auth: no self-serve signup; users are created by an admin.
