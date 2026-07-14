"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/workspaces/data";

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
