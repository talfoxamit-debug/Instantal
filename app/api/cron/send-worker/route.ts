import { NextResponse, type NextRequest } from "next/server";

import { isAuthorizedCron } from "@/lib/cron/auth";
import { runSendWorker } from "@/lib/sending/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The send-worker tick. Driven every minute by Supabase pg_cron (POST, docs/
// SENDING-SETUP.md) or Vercel Cron (GET — Vercel adds `Authorization: Bearer
// $CRON_SECRET` automatically when CRON_SECRET is set). Both are gated by the
// same shared secret.
async function handle(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runSendWorker();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "worker_failed" },
      { status: 500 },
    );
  }
}

export const POST = handle;
export const GET = handle;
