import type { SupabaseClient } from "@supabase/supabase-js";

import { nextWindowOpen, timeToMinutes, type SendWindow } from "@/lib/campaigns/schedule";

export interface EnqueueResult {
  enqueued: number;
  skippedExisting: number;
  eligible: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Build the initial send queue for a campaign launch. Only VERIFIED, active
// leads in the campaign's list are enqueued (never send to unverified —
// Section 5.1); suppressed/unsubscribed/bounced leads are excluded because the
// suppression path sets leads.status off 'active'. Inboxes and step-1 A/B
// variants are assigned round-robin. First sends are scheduled at the next
// open send window; the worker paces them from there.
export async function enqueueCampaign(
  supabase: SupabaseClient,
  workspaceId: string,
  campaignId: string,
  now: Date,
): Promise<EnqueueResult> {
  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .select(
      "list_id, inbox_ids, send_window_start, send_window_end, send_days, timezone_mode, fixed_timezone",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", campaignId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!campaign) throw new Error("Campaign not found.");
  if (!campaign.list_id) throw new Error("Campaign has no list.");
  const inboxIds = (campaign.inbox_ids as string[]) ?? [];
  if (inboxIds.length === 0) throw new Error("Campaign has no inboxes.");

  // Resolve the send window's timezone. 'lead' mode uses the workspace default
  // until per-lead timezones exist (Phase 6 enrichment).
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("default_timezone")
    .eq("id", workspaceId)
    .maybeSingle();
  const timeZone =
    campaign.timezone_mode === "fixed" && campaign.fixed_timezone
      ? (campaign.fixed_timezone as string)
      : (workspace?.default_timezone as string) ?? "America/New_York";

  const window: SendWindow = {
    startMinute: timeToMinutes(campaign.send_window_start as string),
    endMinute: timeToMinutes(campaign.send_window_end as string),
    days: (campaign.send_days as number[]) ?? [1, 2, 3, 4, 5],
    timeZone,
  };
  const scheduledAt = nextWindowOpen(now, window).toISOString();

  // First-step variants (share the lowest step_no).
  const { data: steps } = await supabase
    .from("campaign_steps")
    .select("id, step_no")
    .eq("workspace_id", workspaceId)
    .eq("campaign_id", campaignId)
    .order("step_no", { ascending: true });
  if (!steps || steps.length === 0) throw new Error("Campaign has no steps.");
  const firstStepNo = steps[0].step_no as number;
  const firstVariants = steps
    .filter((s) => s.step_no === firstStepNo)
    .map((s) => s.id as string);

  // Verified, active leads in the list.
  const { data: memberRows, error: mErr } = await supabase
    .from("list_members")
    .select("lead_id, leads!inner(id, verify_status, status)")
    .eq("workspace_id", workspaceId)
    .eq("list_id", campaign.list_id as string)
    .eq("leads.verify_status", "valid")
    .eq("leads.status", "active");
  if (mErr) throw new Error(mErr.message);
  const candidateLeadIds = (memberRows ?? []).map((r) => r.lead_id as string);

  // Skip leads already enrolled in this campaign.
  const { data: existing } = await supabase
    .from("campaign_leads")
    .select("lead_id")
    .eq("workspace_id", workspaceId)
    .eq("campaign_id", campaignId);
  const existingSet = new Set((existing ?? []).map((r) => r.lead_id as string));

  const eligible = candidateLeadIds.filter((id) => !existingSet.has(id));

  const campaignLeadRows = eligible.map((leadId) => ({
    workspace_id: workspaceId,
    campaign_id: campaignId,
    lead_id: leadId,
    status: "queued",
    current_step: 0,
    next_send_at: scheduledAt,
  }));
  const queueRows = eligible.map((leadId, i) => ({
    workspace_id: workspaceId,
    campaign_id: campaignId,
    lead_id: leadId,
    step_id: firstVariants[i % firstVariants.length],
    inbox_id: inboxIds[i % inboxIds.length],
    scheduled_at: scheduledAt,
    status: "pending",
  }));

  for (const batch of chunk(campaignLeadRows, 500)) {
    const { error } = await supabase
      .from("campaign_leads")
      .upsert(batch, { onConflict: "campaign_id,lead_id", ignoreDuplicates: true });
    if (error) throw new Error(`Enqueue (campaign_leads): ${error.message}`);
  }
  for (const batch of chunk(queueRows, 500)) {
    // Idempotent: the send_queue_campaign_lead_step_key unique index makes a
    // concurrent/duplicate launch a no-op instead of a double-enqueue.
    const { error } = await supabase
      .from("send_queue")
      .upsert(batch, {
        onConflict: "campaign_id,lead_id,step_id",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`Enqueue (send_queue): ${error.message}`);
  }

  return {
    enqueued: eligible.length,
    skippedExisting: candidateLeadIds.length - eligible.length,
    eligible: candidateLeadIds.length,
  };
}
