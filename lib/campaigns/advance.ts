import type { SupabaseClient } from "@supabase/supabase-js";

// Channel-aware sequence advancement, shared by the email send-worker and the
// LinkedIn worker so a single sequence can mix email + LinkedIn steps. Given the
// step just completed, it finds the next step and enqueues a send_queue row for
// THAT step's channel — an email row (assigned an inbox) or a LinkedIn row
// (assigned a LinkedIn account). Each worker still owns its own channel-specific
// campaign_leads bookkeeping (e.g. email thread_id); this only handles the queue.

type Admin = SupabaseClient;

export interface NextStepResult {
  finished: boolean; // true if there is no next step
  nextSendAt: string | null;
  channel: "email" | "linkedin" | null;
}

export async function enqueueNextStepRow(
  admin: Admin,
  params: {
    workspaceId: string;
    campaignId: string;
    leadId: string;
    currentStepNo: number;
    now: Date;
    currentInboxId?: string | null; // reuse for email→email thread continuity
    currentLinkedinAccountId?: string | null; // reuse for linkedin→linkedin
  },
): Promise<NextStepResult> {
  const { data: nextStep } = await admin
    .from("campaign_steps")
    .select("id, step_no, delay_days, channel")
    .eq("campaign_id", params.campaignId)
    .gt("step_no", params.currentStepNo)
    .order("step_no", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!nextStep) return { finished: true, nextSendAt: null, channel: null };

  const channel = (nextStep.channel as "email" | "linkedin") ?? "email";
  const nextSendAt = new Date(
    params.now.getTime() + (nextStep.delay_days as number) * 86_400_000,
  ).toISOString();

  const { data: campaign } = await admin
    .from("campaigns")
    .select("inbox_ids, linkedin_account_ids")
    .eq("id", params.campaignId)
    .maybeSingle();

  const row: Record<string, unknown> = {
    workspace_id: params.workspaceId,
    campaign_id: params.campaignId,
    lead_id: params.leadId,
    step_id: nextStep.id,
    scheduled_at: nextSendAt,
    status: "pending",
    channel,
  };

  if (channel === "linkedin") {
    const accounts = (campaign?.linkedin_account_ids as string[] | null) ?? [];
    row.linkedin_account_id = params.currentLinkedinAccountId ?? accounts[0] ?? null;
  } else {
    const inboxes = (campaign?.inbox_ids as string[] | null) ?? [];
    row.inbox_id = params.currentInboxId ?? inboxes[0] ?? null;
  }

  // Idempotent: the send_queue unique index (campaign,lead,step) makes a
  // duplicate advance a no-op instead of a double-enqueue.
  await admin
    .from("send_queue")
    .upsert(row, { onConflict: "campaign_id,lead_id,step_id", ignoreDuplicates: true });

  return { finished: false, nextSendAt, channel };
}
