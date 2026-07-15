import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseUrl } from "@/lib/supabase/config";

// Service-role client for server-only workers (send-worker, reply-worker) and
// public endpoints that must act without a user session (unsubscribe,
// tracking). BYPASSES RLS — never import this into anything reachable by a
// browser/client component, and always scope queries by workspace_id yourself.
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    throw new Error("SUPABASE_SECRET_KEY is not set (service-role key).");
  }
  return createSupabaseClient(getSupabaseUrl(), secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
