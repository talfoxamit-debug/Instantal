"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  ACTIVE_WORKSPACE_COOKIE,
  requireActiveWorkspaceId,
} from "@/lib/workspaces/data";

async function setActiveWorkspaceCookie(workspaceId: string) {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function createWorkspace(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const venture = String(formData.get("venture") ?? "").trim();
  const physicalAddress = String(formData.get("physical_address") ?? "").trim();
  const timezone = String(formData.get("default_timezone") ?? "").trim();
  const rawOrigin = String(formData.get("origin_path") ?? "");
  const originPath =
    rawOrigin === "/workspaces/new" ? rawOrigin : "/onboarding";

  if (!name || !venture) {
    redirect(
      `${originPath}?error=${encodeURIComponent("Name and venture are required.")}`,
    );
  }

  const supabase = await createClient();
  const { data: workspaceId, error } = await supabase.rpc("create_workspace", {
    p_name: name,
    p_venture: venture,
    p_physical_address: physicalAddress || null,
    p_default_timezone: timezone || "America/New_York",
  });

  if (error || !workspaceId) {
    redirect(
      `${originPath}?error=${encodeURIComponent(error?.message ?? "Could not create workspace.")}`,
    );
  }

  await setActiveWorkspaceCookie(workspaceId as string);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

// Edit the active workspace's settings. Owner-only is enforced by the
// "owners can update their workspaces" RLS policy (this uses the RLS-scoped
// client, so a non-owner's update simply affects zero rows / errors).
export async function updateWorkspaceSettings(formData: FormData): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const name = String(formData.get("name") ?? "").trim();
  const venture = String(formData.get("venture") ?? "").trim();
  const physicalAddress = String(formData.get("physical_address") ?? "").trim();
  const timezone = String(formData.get("default_timezone") ?? "").trim();
  if (!name || !venture) throw new Error("Name and venture are required.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({
      name,
      venture,
      physical_address: physicalAddress || null,
      default_timezone: timezone || "America/New_York",
    })
    .eq("id", workspaceId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/workspace");
  revalidatePath("/", "layout");
}

// Add an existing user (created via `npm run create-user`) to the active
// workspace. The service-role client only RESOLVES the email to a user id; the
// membership INSERT goes through the RLS client so the "owners can add members"
// policy authorizes it — a non-owner cannot add anyone.
export async function addMemberByEmail(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("A valid email is required.");
  const workspaceId = await requireActiveWorkspaceId();

  // Resolve email -> user id (the person must already have a login).
  const admin = createAdminClient();
  let userId: string | undefined;
  let page = 1;
  // Paginate defensively; an internal tool has a small user set.
  for (; page <= 10 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
    if (data.users.length < 200) break;
  }
  if (!userId) {
    throw new Error(
      `No user with that email. Create their login first: npm run create-user -- ${email}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("members")
    .insert({ workspace_id: workspaceId, user_id: userId, role: "member" });
  if (error) {
    if (error.code === "23505") throw new Error("Already a member of this workspace.");
    throw new Error(error.message);
  }
  revalidatePath("/settings/members");
}

// Remove a member from the active workspace. RLS ("owners can remove members")
// authorizes it, and the last-owner trigger blocks removing the final owner.
export async function removeMember(userId: string): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/members");
}

export async function setActiveWorkspace(workspaceId: string) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) return;

  const { data, error } = await supabase
    .from("members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    // Not a member (or workspace gone): keep the current selection.
    return;
  }

  await setActiveWorkspaceCookie(workspaceId);
  revalidatePath("/", "layout");
}
