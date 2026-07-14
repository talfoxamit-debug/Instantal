"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getLaunchChecklist } from "@/lib/campaigns/data";
import { enqueueCampaign } from "@/lib/campaigns/enqueue";
import { createClient } from "@/lib/supabase/server";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

export async function createCampaign(formData: FormData): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Campaign name is required.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .insert({ workspace_id: workspaceId, name })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  redirect(`/campaigns/${data.id}`);
}

export interface CampaignSettingsInput {
  name?: string;
  list_id?: string | null;
  inbox_ids?: string[];
  send_window_start?: string;
  send_window_end?: string;
  send_days?: number[];
  timezone_mode?: "lead" | "fixed";
  fixed_timezone?: string | null;
  track_opens?: boolean;
  track_clicks?: boolean;
  stop_on_reply?: boolean;
  daily_limit?: number | null;
}

export async function updateCampaignSettings(
  campaignId: string,
  input: CampaignSettingsInput,
): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  // Only whitelist known columns; ignore anything else.
  const patch: Record<string, unknown> = {};
  for (const key of [
    "name",
    "list_id",
    "inbox_ids",
    "send_window_start",
    "send_window_end",
    "send_days",
    "timezone_mode",
    "fixed_timezone",
    "track_opens",
    "track_clicks",
    "stop_on_reply",
    "daily_limit",
  ] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  const { error } = await supabase
    .from("campaigns")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", campaignId);
  if (error) throw new Error(error.message);
  revalidatePath(`/campaigns/${campaignId}`);
}

export interface StepInput {
  id?: string;
  step_no: number;
  delay_days: number;
  subject: string;
  body_text: string;
  body_html?: string | null;
  variant_group?: string;
}

export async function saveStep(
  campaignId: string,
  step: StepInput,
): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const row = {
    workspace_id: workspaceId,
    campaign_id: campaignId,
    step_no: step.step_no,
    delay_days: step.delay_days,
    subject: step.subject,
    body_text: step.body_text,
    body_html: step.body_html ?? null,
    variant_group: step.variant_group ?? "A",
  };
  if (step.id) {
    const { error } = await supabase
      .from("campaign_steps")
      .update(row)
      .eq("workspace_id", workspaceId)
      .eq("id", step.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("campaign_steps").insert(row);
    if (error) {
      if (error.code === "23505") {
        throw new Error("A variant with that letter already exists for this step.");
      }
      throw new Error(error.message);
    }
  }
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function deleteStep(
  campaignId: string,
  stepId: string,
): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("campaign_steps")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", stepId);
  if (error) throw new Error(error.message);
  revalidatePath(`/campaigns/${campaignId}`);
}

// Launch: hard-gate on the checklist, then enqueue the first step. Idempotent
// on re-launch (already-enrolled leads are skipped).
export async function launchCampaign(campaignId: string): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const checklist = await getLaunchChecklist(campaignId);
  if (!checklist.passes) {
    const failing = checklist.items
      .filter((i) => i.required && !i.ok)
      .map((i) => i.label)
      .join("; ");
    throw new Error(`Launch blocked: ${failing}`);
  }

  const supabase = await createClient();

  // Serialize launches with a status compare-and-set: only the launch that
  // flips the campaign to 'active' proceeds to enqueue. A concurrent second
  // launch finds status already 'active' and no-ops, so it can't double-enqueue
  // (the unique index on send_queue is the belt to this suspenders).
  const { data: won } = await supabase
    .from("campaigns")
    .update({ status: "active" })
    .eq("workspace_id", workspaceId)
    .eq("id", campaignId)
    .neq("status", "active")
    .select("id");
  if (!won || won.length === 0) {
    // Already active (or a concurrent launch won): still enqueue any newly
    // eligible leads (idempotent), but don't treat it as an error.
    await enqueueCampaign(supabase, workspaceId, campaignId, new Date());
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");
    return;
  }

  await enqueueCampaign(supabase, workspaceId, campaignId, new Date());
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
}

export async function setCampaignStatus(
  campaignId: string,
  status: "active" | "paused",
): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  // Pausing stops future sends by cancelling pending queue rows; the campaign
  // can be resumed (re-launched) later to re-enqueue.
  if (status === "paused") {
    await supabase
      .from("send_queue")
      .update({ status: "cancelled", error: "campaign_paused" })
      .eq("workspace_id", workspaceId)
      .eq("campaign_id", campaignId)
      .eq("status", "pending");
  }
  const { error } = await supabase
    .from("campaigns")
    .update({ status })
    .eq("workspace_id", workspaceId)
    .eq("id", campaignId);
  if (error) throw new Error(error.message);
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
}

// Duplicate a campaign's settings + steps into a fresh draft (no leads/queue).
export async function duplicateCampaign(campaignId: string): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data: src } = await supabase
    .from("campaigns")
    .select("*, campaign_steps(*)")
    .eq("workspace_id", workspaceId)
    .eq("id", campaignId)
    .maybeSingle();
  if (!src) throw new Error("Campaign not found.");

  const { data: copy, error } = await supabase
    .from("campaigns")
    .insert({
      workspace_id: workspaceId,
      name: `${src.name} (copy)`,
      status: "draft",
      list_id: src.list_id,
      inbox_ids: src.inbox_ids,
      send_window_start: src.send_window_start,
      send_window_end: src.send_window_end,
      send_days: src.send_days,
      timezone_mode: src.timezone_mode,
      fixed_timezone: src.fixed_timezone,
      track_opens: src.track_opens,
      track_clicks: src.track_clicks,
      stop_on_reply: src.stop_on_reply,
      daily_limit: src.daily_limit,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const steps = (src.campaign_steps as Record<string, unknown>[]) ?? [];
  if (steps.length > 0) {
    const rows = steps.map((s) => ({
      workspace_id: workspaceId,
      campaign_id: copy.id,
      step_no: s.step_no,
      delay_days: s.delay_days,
      subject: s.subject,
      body_text: s.body_text,
      body_html: s.body_html,
      variant_group: s.variant_group,
    }));
    await supabase.from("campaign_steps").insert(rows);
  }
  redirect(`/campaigns/${copy.id}`);
}
