import { createClient } from "@/lib/supabase/server";
import type { SuppressionEntry } from "@/lib/types";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

export interface SuppressionPage {
  entries: SuppressionEntry[];
  count: number;
}

const PAGE_SIZE = 100;

// RLS returns global (workspace_id null) + this workspace's entries. We fetch
// the active workspace to scope explicitly and to label which are global.
export async function getSuppression(
  search = "",
  page = 0,
): Promise<SuppressionPage> {
  await requireActiveWorkspaceId();
  const supabase = await createClient();
  let query = supabase
    .from("suppression")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (search) query = query.ilike("email", `%${search}%`);
  const { data, count, error } = await query;
  if (error) throw new Error(`Failed to load suppression: ${error.message}`);
  return { entries: (data ?? []) as SuppressionEntry[], count: count ?? 0 };
}
