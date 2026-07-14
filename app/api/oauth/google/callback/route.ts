import { NextResponse, type NextRequest } from "next/server";

import { verifyState } from "@/lib/crypto/sign";
import { encryptToken } from "@/lib/crypto/tokens";
import { exchangeCode, fetchGoogleEmail } from "@/lib/gmail/oauth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function settingsRedirect(request: NextRequest, params: string) {
  return NextResponse.redirect(
    new URL(`/settings/inboxes?${params}`, request.url),
  );
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return settingsRedirect(request, `error=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !stateToken) {
    return settingsRedirect(request, "error=missing_code");
  }

  const state = verifyState<{ ws: string; uid: string }>(stateToken, Date.now());
  if (!state) {
    return settingsRedirect(request, "error=invalid_state");
  }

  // The session user must match who started the flow (CSRF defense), and must
  // still be a member of the target workspace (checked via RLS on insert).
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId || userId !== state.uid) {
    return settingsRedirect(request, "error=session_mismatch");
  }

  try {
    const tokens = await exchangeCode(code, url.origin);
    if (!tokens.refresh_token) {
      // Google only returns a refresh_token with prompt=consent + offline; if
      // the user previously authorized, they must revoke and reconnect.
      return settingsRedirect(request, "error=no_refresh_token");
    }
    const email = await fetchGoogleEmail(tokens.access_token);
    const encrypted = encryptToken(tokens.refresh_token);

    // Attach the inbox to the workspace from state. RLS enforces the user is a
    // member; onConflict updates the token if reconnecting the same mailbox.
    const { error } = await supabase.from("inboxes").upsert(
      {
        workspace_id: state.ws,
        email,
        provider: "google",
        oauth_refresh_token_enc: encrypted,
        status: "paused",
        warmup_status: "not_started",
      },
      { onConflict: "workspace_id,email" },
    );
    if (error) {
      return settingsRedirect(
        request,
        `error=${encodeURIComponent(error.message)}`,
      );
    }
    return settingsRedirect(request, `connected=${encodeURIComponent(email)}`);
  } catch (e) {
    return settingsRedirect(
      request,
      `error=${encodeURIComponent(e instanceof Error ? e.message : "connect_failed")}`,
    );
  }
}
