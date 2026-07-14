import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Click tracking: record the click, then 302 to the real destination passed as
// ?u=<encoded url>. Only http(s) targets are honored (no open-redirect to
// javascript:/data: or off-scheme). Behind the per-campaign track_clicks flag.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const target = request.nextUrl.searchParams.get("u");

  let destination: URL | null = null;
  if (target) {
    try {
      const parsed = new URL(target);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        destination = parsed;
      }
    } catch {
      destination = null;
    }
  }

  try {
    const admin = createAdminClient();
    await admin.rpc("record_tracking_event", { p_email_id: id, p_type: "click" });
  } catch {
    // Recording failure must not strand the recipient — still redirect.
  }

  if (!destination) {
    return NextResponse.json({ error: "invalid_target" }, { status: 400 });
  }
  return NextResponse.redirect(destination, 302);
}
