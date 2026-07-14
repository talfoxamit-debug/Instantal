import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-click unsubscribe (RFC 8058). Two entry points:
//  - POST: the mail client's List-Unsubscribe-Post one-click action.
//  - GET:  the visible footer link a human clicks.
// Both resolve the opaque token -> global suppression via process_unsubscribe.
// No auth: the token is the capability.

async function unsubscribe(token: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("process_unsubscribe", {
    p_token: token,
  });
  if (error) return false;
  return Boolean((data as { ok?: boolean } | null)?.ok);
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  await unsubscribe(token);
  // One-click clients want a 200 regardless of detail.
  return new NextResponse(null, { status: 200 });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const ok = await unsubscribe(token);
  const body = ok
    ? `<!doctype html><meta charset="utf-8"><title>Unsubscribed</title>
       <div style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center">
       <h1>You're unsubscribed</h1>
       <p>You won't receive any more emails from us. This takes effect immediately.</p></div>`
    : `<!doctype html><meta charset="utf-8"><title>Unsubscribe</title>
       <div style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center">
       <h1>Link expired</h1>
       <p>This unsubscribe link is invalid or already used. If you keep getting
       emails, reply with "unsubscribe" and we'll remove you.</p></div>`;
  return new NextResponse(body, {
    status: ok ? 200 : 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
