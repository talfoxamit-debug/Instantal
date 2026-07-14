import { type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1x1 transparent GIF. Open tracking is OFF by default (Section 5.5) — the
// pixel is only embedded when a campaign opts in, but the endpoint always
// returns the image so it never breaks a client that requests it.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

function pixelResponse() {
  return new Response(new Uint8Array(PIXEL), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
    },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const admin = createAdminClient();
    await admin.rpc("record_tracking_event", { p_email_id: id, p_type: "open" });
  } catch {
    // Never let tracking failure affect the pixel response.
  }
  return pixelResponse();
}
