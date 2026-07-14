import { cookies } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
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

// Resolve the active workspace id for a mutation/query, validated against the
// caller's real memberships. Throws if the user has no workspace — callers in
// the authenticated app always do, so this doubles as an auth guard.
export async function requireActiveWorkspaceId(): Promise<string> {
  const memberships = await getUserMemberships();
  const workspace = await getActiveWorkspace(memberships);
  if (!workspace) {
    throw new Error("No active workspace");
  }
  return workspace.id;
}

// The active workspace plus the caller's role in it — for gating owner-only
// settings (member management, workspace edit).
export async function getActiveWorkspaceWithRole(): Promise<{
  workspace: Workspace;
  role: string;
} | null> {
  const memberships = await getUserMemberships();
  const active = await getActiveWorkspace(memberships);
  if (!active) return null;
  const role =
    memberships.find((m) => m.workspace.id === active.id)?.role ?? "member";
  return { workspace: active, role };
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  role: string;
}

// Members of the active workspace, with emails. RLS returns the membership rows
// (a member can see co-members of their own workspaces); emails live in
// auth.users and are resolved with the service-role client for exactly those
// ids — no cross-workspace exposure since the id set is RLS-filtered first.
export async function getWorkspaceMembers(): Promise<WorkspaceMember[]> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("members")
    .select("user_id, role, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const admin = createAdminClient();
  return Promise.all(
    (rows ?? []).map(async (r) => {
      const { data } = await admin.auth.admin.getUserById(r.user_id as string);
      return {
        userId: r.user_id as string,
        email: data.user?.email ?? "(unknown)",
        role: r.role as string,
      };
    }),
  );
}
