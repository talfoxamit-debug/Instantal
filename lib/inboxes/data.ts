import { rampCap, rampConfigToSchedule, type RampConfig } from "@/lib/sending/ramp";
import { createClient } from "@/lib/supabase/server";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

export interface InboxView {
  id: string;
  email: string;
  display_name: string | null;
  provider: string;
  status: "active" | "paused" | "burned";
  daily_cap: number;
  warmup_status: string;
  warmup_started_at: string | null;
  last_send_at: string | null;
  health_score: number | null;
  domain: string | null;
  connected: boolean; // has an OAuth refresh token stored
  ramp_cap: number; // today's allowed volume under the ramp schedule
  ramp_config: RampConfig | null; // null = using the platform default schedule
  sent_today: number;
}

export interface DomainView {
  id: string;
  domain: string;
  tracking_domain: string | null;
  dns_spf: boolean;
  dns_dkim: boolean;
  dns_dmarc: boolean;
  dns_verified_at: string | null;
  redirect_ok: boolean;
  status: string;
  inbox_count: number;
}

export async function getInboxes(): Promise<InboxView[]> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const now = new Date();
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();

  // Never select oauth_refresh_token_enc into the UI layer; derive a boolean.
  const { data, error } = await supabase
    .from("inboxes")
    .select(
      "id, email, display_name, provider, status, daily_cap, warmup_status, warmup_started_at, last_send_at, health_score, oauth_refresh_token_enc, ramp_schedule, sending_domains(domain)",
    )
    .eq("workspace_id", workspaceId)
    // Seeds only receive placement-test mail; they are managed on the
    // Deliverability test page and must not appear as sendable inboxes.
    .eq("is_seed", false)
    .order("email");
  if (error) throw new Error(`Failed to load inboxes: ${error.message}`);

  const rows = data ?? [];
  const views: InboxView[] = [];
  for (const r of rows) {
    const { count } = await supabase
      .from("emails")
      .select("*", { count: "exact", head: true })
      .eq("inbox_id", r.id)
      .gte("sent_at", startOfDay);
    const domain =
      (r.sending_domains as unknown as { domain: string } | null)?.domain ?? null;
    const rampConfig = (r.ramp_schedule as RampConfig | null) ?? null;
    views.push({
      id: r.id as string,
      email: r.email as string,
      display_name: (r.display_name as string) ?? null,
      provider: r.provider as string,
      status: r.status as InboxView["status"],
      daily_cap: r.daily_cap as number,
      warmup_status: r.warmup_status as string,
      warmup_started_at: (r.warmup_started_at as string) ?? null,
      last_send_at: (r.last_send_at as string) ?? null,
      health_score: (r.health_score as number) ?? null,
      domain,
      connected: Boolean(r.oauth_refresh_token_enc),
      ramp_cap: rampCap(
        r.warmup_started_at ? new Date(r.warmup_started_at as string) : null,
        r.daily_cap as number,
        now,
        rampConfig ? rampConfigToSchedule(rampConfig) : undefined,
      ),
      ramp_config: rampConfig,
      sent_today: count ?? 0,
    });
  }
  return views;
}

export async function getSendingDomains(): Promise<DomainView[]> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sending_domains")
    .select(
      "id, domain, tracking_domain, dns_spf, dns_dkim, dns_dmarc, dns_verified_at, redirect_ok, status, inboxes(count)",
    )
    .eq("workspace_id", workspaceId)
    .order("domain");
  if (error) throw new Error(`Failed to load domains: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    domain: r.domain as string,
    tracking_domain: (r.tracking_domain as string) ?? null,
    dns_spf: r.dns_spf as boolean,
    dns_dkim: r.dns_dkim as boolean,
    dns_dmarc: r.dns_dmarc as boolean,
    dns_verified_at: (r.dns_verified_at as string) ?? null,
    redirect_ok: r.redirect_ok as boolean,
    status: r.status as string,
    inbox_count:
      (r.inboxes as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
  }));
}
