"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getUnipileClient, unipileConfigured } from "@/lib/unipile/client";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

function appUrl(): string {
  const url = process.env.APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!url) throw new Error("APP_URL is not set.");
  return url.replace(/\/$/, "");
}

// Begin connecting a LinkedIn account: create the pending row, then return a
// Unipile hosted-auth link for the operator to open. On success Unipile calls
// our notify webhook (/api/linkedin/notify) with the account id, keyed by the
// row id we pass as `name`.
export async function startLinkedinConnect(displayName: string): Promise<{ url: string }> {
  const workspaceId = await requireActiveWorkspaceId();
  if (!unipileConfigured()) {
    throw new Error("LinkedIn isn't set up. Set UNIPILE_DSN and UNIPILE_API_KEY.");
  }
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("linkedin_accounts")
    .insert({ workspace_id: workspaceId, name: displayName.trim() || "LinkedIn account", status: "pending" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const base = appUrl();
  const { url } = await getUnipileClient().createHostedAuthLink({
    successUrl: `${base}/settings/linkedin?connected=1`,
    failureUrl: `${base}/settings/linkedin?error=1`,
    notifyUrl: `${base}/api/linkedin/notify`,
    name: row.id as string,
  });
  revalidatePath("/settings/linkedin");
  return { url };
}

export async function setLinkedinCaps(
  accountId: string,
  dailyInviteCap: number,
  dailyMessageCap: number,
): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  if (
    !Number.isFinite(dailyInviteCap) || dailyInviteCap < 0 || dailyInviteCap > 100 ||
    !Number.isFinite(dailyMessageCap) || dailyMessageCap < 0 || dailyMessageCap > 200
  ) {
    throw new Error("Invite cap must be 0-100 and message cap 0-200.");
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("linkedin_accounts")
    .update({
      daily_invite_cap: Math.floor(dailyInviteCap),
      daily_message_cap: Math.floor(dailyMessageCap),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", accountId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/linkedin");
}

export async function deleteLinkedinAccount(accountId: string): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("linkedin_accounts")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", accountId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/linkedin");
}
