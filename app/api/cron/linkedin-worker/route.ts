import { NextResponse, type NextRequest } from "next/server";

import { isAuthorizedCron } from "@/lib/cron/auth";
import { ingestLinkedinReplies } from "@/lib/linkedin/ingest";
import { runLinkedinWorker } from "@/lib/linkedin/worker";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// LinkedIn dispatch + reply ingestion. Runs every ~15 min via pg_cron (POST) or
// Vercel Cron (GET). LinkedIn actions are heavily throttled per account, so a
// slower cadence than email is intentional. Gated by CRON_SECRET.
async function handle(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const sent = await runLinkedinWorker();
    const ingest = await ingestLinkedinReplies(createAdminClient());
    return NextResponse.json({ ok: true, sent, ingest });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "worker_failed" },
      { status: 500 },
    );
  }
}

export const POST = handle;
export const GET = handle;
