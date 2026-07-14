import { NextResponse, type NextRequest } from "next/server";

import { signState } from "@/lib/crypto/sign";
import { buildAuthUrl } from "@/lib/gmail/oauth";
import { createClient } from "@/lib/supabase/server";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

export const runtime = "nodejs";

// Kick off Gmail OAuth for the active workspace. Requires a session; encodes
// (workspace, user) into a signed, short-lived state so the callback can trust
// it and resist CSRF.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  let workspaceId: string;
  try {
    workspaceId = await requireActiveWorkspaceId();
  } catch {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const origin = request.nextUrl.origin;
  const state = signState(
    { ws: workspaceId, uid: userId },
    600, // 10 minutes
    Date.now(),
  );
  return NextResponse.redirect(buildAuthUrl(origin, state));
}
