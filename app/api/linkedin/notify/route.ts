import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unipile hosted-auth callback. On a successful connect, Unipile POSTs the new
// account id plus our `name` (the linkedin_accounts row id we created). We flip
// that row to 'connected' and store the Unipile account id + DSN. This is a
// server-to-server webhook with no user session, so it uses the admin client;
// it only ever transitions a row WE created (matched by our own uuid), so it
// can't be used to touch arbitrary data.
export async function POST(request: NextRequest) {
  let body: { status?: string; account_id?: string; name?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const rowId = body.name;
  const accountId = body.account_id;
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!rowId || !uuidRe.test(rowId) || !accountId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const connected =
    !body.status ||
    /success|created|ok/i.test(body.status); // Unipile: "CREATION_SUCCESS"

  const admin = createAdminClient();
  await admin
    .from("linkedin_accounts")
    .update({
      unipile_account_id: accountId,
      unipile_dsn: process.env.UNIPILE_DSN ?? null,
      status: connected ? "connected" : "error",
      last_error: connected ? null : (body.status ?? "connect_failed"),
    })
    .eq("id", rowId);

  return NextResponse.json({ ok: true });
}
