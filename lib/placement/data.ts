import { createClient } from "@/lib/supabase/server";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";
import type { Placement } from "@/lib/placement/classify";

export interface PlacementTestView {
  id: string;
  inbox_email: string | null;
  status: string;
  seed_count: number;
  inbox_count: number;
  promotions_count: number;
  spam_count: number;
  missing_count: number;
  results: { seed_email: string; placement: Placement }[];
  sent_at: string;
  checked_at: string | null;
}

export interface SeedInboxView {
  id: string;
  email: string;
  connected: boolean;
}

export interface SenderInboxOption {
  id: string;
  email: string;
  connected: boolean;
}

export async function getPlacementTests(limit = 10): Promise<PlacementTestView[]> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("placement_tests")
    .select(
      "id, inbox_email, status, seed_count, inbox_count, promotions_count, spam_count, missing_count, results, sent_at, checked_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load placement tests: ${error.message}`);
  return (data ?? []) as unknown as PlacementTestView[];
}

export async function getSeedInboxes(): Promise<SeedInboxView[]> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data } = await supabase
    .from("inboxes")
    .select("id, email, oauth_refresh_token_enc")
    .eq("workspace_id", workspaceId)
    .eq("is_seed", true)
    .order("email");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    email: r.email as string,
    connected: Boolean(r.oauth_refresh_token_enc),
  }));
}

// Sending inboxes eligible to run a test (connected, not seeds).
export async function getSenderInboxOptions(): Promise<SenderInboxOption[]> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data } = await supabase
    .from("inboxes")
    .select("id, email, oauth_refresh_token_enc")
    .eq("workspace_id", workspaceId)
    .eq("is_seed", false)
    .order("email");
  return (data ?? [])
    .filter((r) => Boolean(r.oauth_refresh_token_enc))
    .map((r) => ({
      id: r.id as string,
      email: r.email as string,
      connected: true,
    }));
}
