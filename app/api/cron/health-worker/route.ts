import { NextResponse, type NextRequest } from "next/server";

import { isAuthorizedCron } from "@/lib/cron/auth";
import { runHealthWorker } from "@/lib/deliverability/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily deliverability health check (Section 5.5). Via pg_cron (POST) or Vercel
// Cron (GET). Both gated by CRON_SECRET.
async function handle(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runHealthWorker();
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
