import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import type { Membership, Workspace } from "@/lib/types";

export const ACTIVE_WORKSPACE_COOKIE = "instantal_workspace";

export async function getUserMemberships(): Promise<Membership[]> {
  const supabase = await createClient();

  // RLS exposes co-members' rows too (needed for member management), so
  // scope explicitly to the caller's own memberships.
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) return [];

  const { data, error } = await supabase
    .from("members")
    .select("role, workspace:workspaces(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load workspaces: ${error.message}`);
  }

  return (data ?? []) as unknown as Membership[];
}

export async function getActiveWorkspace(
  memberships: Membership[],
): Promise<Workspace | null> {
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const activeId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  const active = memberships.find((m) => m.workspace.id === activeId);

  return (active ?? memberships[0]).workspace;
}
