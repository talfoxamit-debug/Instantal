import {
  checklistPasses,
  computeChecklist,
  type ChecklistItem,
} from "@/lib/campaigns/checklist";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

const MIN_DOMAIN_AGE_DAYS = 14;

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  list_id: string | null;
  inbox_ids: string[];
  stop_on_reply: boolean;
  created_at: string;
}

export interface CampaignStep {
  id: string;
  step_no: number;
  delay_days: number;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  variant_group: string;
  channel: "email" | "linkedin";
  linkedin_action: "connect" | "message" | "inmail" | null;
}

export interface CampaignDetail extends CampaignSummary {
  send_window_start: string;
  send_window_end: string;
  send_days: number[];
  timezone_mode: string;
  fixed_timezone: string | null;
  track_opens: boolean;
  track_clicks: boolean;
  daily_limit: number | null;
  linkedin_account_ids: string[];
  steps: CampaignStep[];
}

export async function listCampaigns(): Promise<CampaignSummary[]> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, status, list_id, inbox_ids, stop_on_reply, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load campaigns: ${error.message}`);
  return (data ?? []) as CampaignSummary[];
}

export async function getCampaign(id: string): Promise<CampaignDetail | null> {
  if (!isUuid(id)) return null; // non-UUID route param -> 404, not a 500
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("*, campaign_steps(*)")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load campaign: ${error.message}`);
  if (!data) return null;

  const steps = ((data.campaign_steps as CampaignStep[]) ?? []).sort(
    (a, b) =>
      a.step_no - b.step_no || a.variant_group.localeCompare(b.variant_group),
  );
  return { ...(data as unknown as CampaignDetail), steps };
}

export interface LaunchChecklist {
  items: ChecklistItem[];
  passes: boolean;
  eligibleLeadCount: number;
}

export interface SampleLead {
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  email: string;
  custom: Record<string, unknown>;
}

// A representative lead for merge-tag preview: prefer one from the campaign's
// list, else any lead in the workspace.
export async function getSampleLead(
  listId: string | null,
): Promise<SampleLead | null> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  if (listId) {
    const { data } = await supabase
      .from("list_members")
      .select("leads!inner(first_name, last_name, company, title, email, custom)")
      .eq("workspace_id", workspaceId)
      .eq("list_id", listId)
      .limit(1)
      .maybeSingle();
    const lead = (data as unknown as { leads: SampleLead } | null)?.leads;
    if (lead) return lead;
  }
  const { data } = await supabase
    .from("leads")
    .select("first_name, last_name, company, title, email, custom")
    .eq("workspace_id", workspaceId)
    .limit(1)
    .maybeSingle();
  return (data as SampleLead) ?? null;
}

export async function getLaunchChecklist(
  campaignId: string,
): Promise<LaunchChecklist> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();

  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found.");

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("physical_address")
    .eq("id", workspaceId)
    .maybeSingle();

  // Channel mix. The first step's channel decides who is enrolled at launch and
  // which infrastructure the gate requires (email vs LinkedIn).
  const stepNos = campaign.steps.map((s) => s.step_no);
  const firstNo = stepNos.length ? Math.min(...stepNos) : null;
  const firstStepGroup =
    firstNo != null ? campaign.steps.filter((s) => s.step_no === firstNo) : [];
  const firstStepChannel: "email" | "linkedin" =
    firstStepGroup[0]?.channel === "linkedin" ? "linkedin" : "email";
  const hasEmailStep = campaign.steps.some((s) => s.channel !== "linkedin");
  const hasLinkedinStep = campaign.steps.some((s) => s.channel === "linkedin");

  // Step completeness of the first step group: an email step needs subject + a
  // body; a LinkedIn connect needs only its action (the note is optional), a
  // LinkedIn message needs body text.
  const stepComplete = (s: CampaignStep): boolean => {
    if (s.channel === "linkedin") {
      if (!s.linkedin_action) return false;
      return s.linkedin_action === "connect" ? true : !!s.body_text?.trim();
    }
    return (
      !!s.subject?.trim() && (!!s.body_text?.trim() || !!s.body_html?.trim())
    );
  };
  const firstStepComplete = firstStepGroup.some(stepComplete);

  // Lead counts within the selected list.
  let verifiedLeadCount = 0;
  let unverifiedLeadCount = 0;
  let linkedinLeadCount = 0;
  if (campaign.list_id) {
    const [{ count: verified }, { count: unverified }] = await Promise.all([
      supabase
        .from("list_members")
        .select("lead_id, leads!inner(verify_status, status)", {
          count: "exact",
          head: true,
        })
        .eq("workspace_id", workspaceId)
        .eq("list_id", campaign.list_id)
        .eq("leads.verify_status", "valid")
        .eq("leads.status", "active"),
      supabase
        .from("list_members")
        .select("lead_id, leads!inner(verify_status)", {
          count: "exact",
          head: true,
        })
        .eq("workspace_id", workspaceId)
        .eq("list_id", campaign.list_id)
        .neq("leads.verify_status", "valid"),
    ]);
    verifiedLeadCount = verified ?? 0;
    unverifiedLeadCount = unverified ?? 0;

    if (firstStepChannel === "linkedin") {
      const { count: liCount } = await supabase
        .from("list_members")
        .select("lead_id, leads!inner(custom, status)", {
          count: "exact",
          head: true,
        })
        .eq("workspace_id", workspaceId)
        .eq("list_id", campaign.list_id)
        .eq("leads.status", "active")
        .not("leads.custom->>linkedin_url", "is", null);
      linkedinLeadCount = liCount ?? 0;
    }
  }

  // LinkedIn accounts assigned to the campaign + how many are connected.
  const linkedinAccountIds = campaign.linkedin_account_ids ?? [];
  let connectedLinkedinAccountCount = 0;
  if (linkedinAccountIds.length > 0) {
    const { data: laccts } = await supabase
      .from("linkedin_accounts")
      .select("id, status")
      .eq("workspace_id", workspaceId)
      .in("id", linkedinAccountIds);
    connectedLinkedinAccountCount = (laccts ?? []).filter(
      (a) => a.status === "connected",
    ).length;
  }

  // Selected inboxes + their domains.
  const inboxIds = campaign.inbox_ids ?? [];
  let allInboxesConnected = false;
  let activeInboxCount = 0;
  let allInboxesRamping = false;
  let domainsDnsVerified = false;
  let oldestDomainAgeDays: number | null = null;

  if (inboxIds.length > 0) {
    const { data: inboxes } = await supabase
      .from("inboxes")
      .select(
        "id, oauth_refresh_token_enc, status, warmup_started_at, domain_id",
      )
      .eq("workspace_id", workspaceId)
      .in("id", inboxIds);
    const rows = inboxes ?? [];
    allInboxesConnected =
      rows.length === inboxIds.length &&
      rows.every((r) => !!r.oauth_refresh_token_enc);
    activeInboxCount = rows.filter((r) => r.status === "active").length;
    allInboxesRamping =
      rows.length > 0 && rows.every((r) => !!r.warmup_started_at);

    const domainIds = Array.from(
      new Set(rows.map((r) => r.domain_id).filter(Boolean) as string[]),
    );
    if (domainIds.length > 0) {
      const { data: domains } = await supabase
        .from("sending_domains")
        .select("dns_spf, dns_dkim, dns_dmarc, dns_verified_at, created_at")
        .eq("workspace_id", workspaceId)
        .in("id", domainIds);
      const drows = domains ?? [];
      domainsDnsVerified =
        drows.length === domainIds.length &&
        drows.length > 0 &&
        drows.every(
          (d) =>
            d.dns_spf && d.dns_dkim && d.dns_dmarc && !!d.dns_verified_at,
        );
      const now = Date.now();
      const ages = drows.map((d) =>
        Math.floor(
          (now - new Date(d.created_at as string).getTime()) / 86_400_000,
        ),
      );
      oldestDomainAgeDays = ages.length ? Math.min(...ages) : null;
    } else {
      // Inboxes without a linked domain can't be DNS-verified.
      domainsDnsVerified = false;
      oldestDomainAgeDays = null;
    }
  }

  const items = computeChecklist({
    hasPhysicalAddress: !!workspace?.physical_address?.trim(),
    stepCount: new Set(stepNos).size,
    firstStepComplete,
    hasSendDays: (campaign.send_days ?? []).length > 0,
    listSelected: !!campaign.list_id,
    verifiedLeadCount,
    unverifiedLeadCount,
    inboxCount: inboxIds.length,
    allInboxesConnected,
    activeInboxCount,
    allInboxesRamping,
    domainsDnsVerified,
    oldestDomainAgeDays,
    minDomainAgeDays: MIN_DOMAIN_AGE_DAYS,
    hasEmailStep,
    hasLinkedinStep,
    firstStepChannel,
    linkedinLeadCount,
    linkedinAccountCount: linkedinAccountIds.length,
    connectedLinkedinAccountCount,
  });

  return {
    items,
    passes: checklistPasses(items),
    eligibleLeadCount:
      firstStepChannel === "linkedin" ? linkedinLeadCount : verifiedLeadCount,
  };
}
