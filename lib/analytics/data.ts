import { rampCap } from "@/lib/sending/ramp";
import { createClient } from "@/lib/supabase/server";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";
import {
  rate,
  type CampaignRollup,
  type DomainHealthRow,
  type InboxHealthRow,
  type VariantStat,
} from "@/lib/analytics/types";

export {
  type CampaignRollup,
  type DomainHealthRow,
  type InboxHealthRow,
  type VariantStat,
} from "@/lib/analytics/types";

// All reads go through the RLS-scoped server client + SECURITY INVOKER SQL
// functions, so a member only ever sees their own workspaces' numbers. Rates are
// derived here (the SQL returns raw counts to avoid div-by-zero).

export async function getWorkspaceCampaignStats(): Promise<CampaignRollup[]> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("workspace_campaign_stats", {
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error(`Analytics failed: ${error.message}`);
  return ((data ?? []) as RawCampaign[]).map((r) => {
    const sent = Number(r.sent);
    return {
      campaignId: r.campaign_id,
      name: r.campaign_name,
      status: r.status,
      sent,
      delivered: Number(r.delivered),
      bounced: Number(r.bounced),
      replies: Number(r.replies),
      positive: Number(r.positive),
      bounceRate: rate(Number(r.bounced), sent),
      replyRate: rate(Number(r.replies), sent),
      positiveRate: rate(Number(r.positive), sent),
    };
  });
}

export async function getCampaignVariantStats(
  campaignId: string,
): Promise<VariantStat[]> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("campaign_variant_stats", {
    p_workspace_id: workspaceId,
    p_campaign_id: campaignId,
  });
  if (error) throw new Error(`Variant stats failed: ${error.message}`);
  return ((data ?? []) as RawVariant[]).map((r) => {
    const sent = Number(r.sent);
    return {
      stepNo: r.step_no,
      variantGroup: r.variant_group,
      stepId: r.step_id,
      sent,
      delivered: Number(r.delivered),
      bounced: Number(r.bounced),
      replies: Number(r.replies),
      positive: Number(r.positive),
      positiveRate: rate(Number(r.positive), sent),
      replyRate: rate(Number(r.replies), sent),
    };
  });
}

export async function getInboxHealth(
  now: Date = new Date(),
): Promise<InboxHealthRow[]> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inbox_health", {
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error(`Inbox health failed: ${error.message}`);
  return ((data ?? []) as RawInbox[]).map((r) => {
    const sent7d = Number(r.sent_7d);
    // Effective cap = ramp-limited cap for today, matching what the send-worker
    // actually enforces (a stored current_ramp_cap can lag the schedule).
    const effectiveCap = rampCap(
      r.warmup_started_at ? new Date(r.warmup_started_at) : null,
      Number(r.daily_cap),
      now,
    );
    return {
      inboxId: r.inbox_id,
      email: r.email,
      status: r.status,
      warmupStatus: r.warmup_status,
      pauseReason: r.pause_reason,
      lastError: r.last_error,
      lastErrorAt: r.last_error_at,
      sendsToday: Number(r.sends_today),
      effectiveCap,
      dailyCap: Number(r.daily_cap),
      bounceRate7d: rate(Number(r.bounced_7d), sent7d),
      replyRate7d: rate(Number(r.replies_7d), sent7d),
      sent7d,
    };
  });
}

export async function getDomainHealth(): Promise<DomainHealthRow[]> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("domain_health", {
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error(`Domain health failed: ${error.message}`);
  return ((data ?? []) as RawDomain[]).map((r) => {
    const sent7d = Number(r.sent_7d);
    return {
      domainId: r.domain_id,
      domain: r.domain,
      status: r.status,
      dnsSpf: r.dns_spf,
      dnsDkim: r.dns_dkim,
      dnsDmarc: r.dns_dmarc,
      dnsVerifiedAt: r.dns_verified_at,
      pauseReason: r.pause_reason,
      bounceCount: Number(r.bounce_count),
      sent7d,
      bounceRate7d: rate(Number(r.bounced_7d), sent7d),
    };
  });
}

interface RawCampaign {
  campaign_id: string;
  campaign_name: string;
  status: string;
  sent: number;
  delivered: number;
  bounced: number;
  replies: number;
  positive: number;
}
interface RawVariant {
  step_no: number;
  variant_group: string;
  step_id: string;
  sent: number;
  delivered: number;
  bounced: number;
  replies: number;
  positive: number;
}
interface RawInbox {
  inbox_id: string;
  email: string;
  status: string;
  warmup_status: string;
  warmup_started_at: string | null;
  daily_cap: number;
  current_ramp_cap: number;
  pause_reason: string | null;
  last_error: string | null;
  last_error_at: string | null;
  sends_today: number;
  sent_7d: number;
  bounced_7d: number;
  replies_7d: number;
}
interface RawDomain {
  domain_id: string;
  domain: string;
  status: string;
  dns_spf: boolean;
  dns_dkim: boolean;
  dns_dmarc: boolean;
  dns_verified_at: string | null;
  pause_reason: string | null;
  bounce_count: number;
  sent_7d: number;
  bounced_7d: number;
}
