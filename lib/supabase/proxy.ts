import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/config";

// Paths reachable without a session. Everything else redirects to /login.
const PUBLIC_PATHS = ["/login", "/auth"];

// Lead-facing endpoints (Phase 2+) must never require auth or receive
// session cookies' redirects: tracking pixels, click redirects, unsubscribe.
const PUBLIC_API_PREFIXES = ["/api/track", "/api/unsubscribe", "/api/cron"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const { pathname } = request.nextUrl;
  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not run code between createServerClient and auth.getClaims().
  // Removing this call can log users out at random with SSR.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Return supabaseResponse as-is so refreshed auth cookies reach the
  // browser. Replacing it without copying cookies desyncs the session.
  return supabaseResponse;
}
