"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

// Activate an inbox for sending. Refuses if it isn't connected (no OAuth
// token) — sending would fail every attempt otherwise. The ramp schedule
// still governs actual volume once active.
export async function activateInbox(inboxId: string): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data: inbox } = await supabase
    .from("inboxes")
    .select("oauth_refresh_token_enc")
    .eq("workspace_id", workspaceId)
    .eq("id", inboxId)
    .maybeSingle();
  if (!inbox?.oauth_refresh_token_enc) {
    throw new Error("Connect the inbox to Google before activating it.");
  }
  const { error } = await supabase
    .from("inboxes")
    .update({ status: "active" })
    .eq("workspace_id", workspaceId)
    .eq("id", inboxId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/inboxes");
}

export async function pauseInbox(inboxId: string): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("inboxes")
    .update({ status: "paused" })
    .eq("workspace_id", workspaceId)
    .eq("id", inboxId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/inboxes");
}

// Start the ramp clock. current_ramp_cap is derived from warmup_started_at at
// send time, so this is what makes the ramp schedule begin.
export async function startWarmup(inboxId: string): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("inboxes")
    .update({
      warmup_started_at: new Date().toISOString(),
      warmup_status: "warming",
    })
    .eq("workspace_id", workspaceId)
    .eq("id", inboxId)
    .is("warmup_started_at", null); // don't reset an already-running ramp
  if (error) throw new Error(error.message);
  revalidatePath("/settings/inboxes");
}

export async function setInboxDailyCap(
  inboxId: string,
  dailyCap: number,
): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  if (!Number.isFinite(dailyCap) || dailyCap < 0 || dailyCap > 500) {
    throw new Error("Daily cap must be between 0 and 500.");
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("inboxes")
    .update({ daily_cap: Math.floor(dailyCap) })
    .eq("workspace_id", workspaceId)
    .eq("id", inboxId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/inboxes");
}

export async function deleteInbox(inboxId: string): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("inboxes")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", inboxId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/inboxes");
}

export async function createSendingDomain(formData: FormData): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const domain = String(formData.get("domain") ?? "")
    .trim()
    .toLowerCase();
  const trackingDomain = String(formData.get("tracking_domain") ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    throw new Error("Enter a valid domain, e.g. getfoxstays.com");
  }
  // Guardrail: never let a revenue domain be used for cold outreach.
  const BLOCKED = ["foxstays.com", "seatophomes.com"];
  if (BLOCKED.some((b) => domain === b || domain.endsWith(`.${b}`))) {
    throw new Error(
      "Revenue domains can't be used for cold outreach. Use a variant domain.",
    );
  }
  const supabase = await createClient();
  const { error } = await supabase.from("sending_domains").insert({
    workspace_id: workspaceId,
    domain,
    tracking_domain: trackingDomain || null,
  });
  if (error) {
    if (error.code === "23505") throw new Error("That domain already exists.");
    throw new Error(error.message);
  }
  revalidatePath("/settings/domains");
}

export async function deleteSendingDomain(domainId: string): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("sending_domains")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", domainId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/domains");
}
