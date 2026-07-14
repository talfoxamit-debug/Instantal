import type { SupabaseClient } from "@supabase/supabase-js";

import { sendOpsAlert } from "@/lib/deliverability/alert";
import {
  checkDomainBlacklists,
  checkDomainDns,
  hostResolves,
} from "@/lib/deliverability/dns";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily deliverability health-worker (Section 5.5). Runs as service_role:
//   1. Apply auto-pause rules (inbox >3% / domain >5% 7d bounce) and alert on
//      exactly the entities newly paused this run.
//   2. Re-check each active sending domain's DNS (SPF/DKIM/DMARC), spot-check
//      domain blocklists, and confirm the tracking subdomain resolves. A record
//      that regressed from verified → definitively absent flips the stored flag
//      and alerts once; transient resolver failures are ignored (never a false
//      alarm that pauses a healthy domain).

type Admin = SupabaseClient;

export interface HealthResult {
  autoPaused: number;
  domainsChecked: number;
  dnsRegressions: number;
  blacklisted: number;
  alertsSent: number;
}

interface PausedEntity {
  kind: string;
  id: string;
  workspace_id: string;
  label: string;
  rate: number;
  sent_7d: number;
  bounced_7d: number;
}

interface DomainRow {
  id: string;
  workspace_id: string;
  domain: string;
  tracking_domain: string | null;
  dns_spf: boolean;
  dns_dkim: boolean;
  dns_dmarc: boolean;
  status: string;
}

export async function runHealthWorker(): Promise<HealthResult> {
  const admin = createAdminClient();
  const result: HealthResult = {
    autoPaused: 0,
    domainsChecked: 0,
    dnsRegressions: 0,
    blacklisted: 0,
    alertsSent: 0,
  };
  const alert = async (text: string, ctx?: Record<string, unknown>) => {
    const r = await sendOpsAlert(text, ctx);
    if (r.sent) result.alertsSent += 1;
  };

  // 1) Auto-pause rules.
  const { data: paused, error: pErr } = await admin.rpc(
    "evaluate_deliverability",
    {},
  );
  if (pErr) throw new Error(`evaluate_deliverability failed: ${pErr.message}`);
  const pausedList = (paused ?? []) as PausedEntity[];
  result.autoPaused = pausedList.length;
  for (const p of pausedList) {
    await alert(
      `⚠️ Auto-paused ${p.kind} "${p.label}" — 7d bounce rate ${(
        p.rate * 100
      ).toFixed(1)}% (${p.bounced_7d}/${p.sent_7d}).`,
      { ...p },
    );
  }

  // 2) DNS + blacklist re-checks on live domains.
  const { data: domains } = await admin
    .from("sending_domains")
    .select(
      "id, workspace_id, domain, tracking_domain, dns_spf, dns_dkim, dns_dmarc, status",
    )
    .in("status", ["active", "verifying"]);

  for (const d of (domains ?? []) as DomainRow[]) {
    result.domainsChecked += 1;
    await checkOneDomain(admin, d, result, alert);
  }

  return result;
}

async function checkOneDomain(
  admin: Admin,
  d: DomainRow,
  result: HealthResult,
  alert: (text: string, ctx?: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const dns = await checkDomainDns(d.domain);
  const blacklist = await checkDomainBlacklists(d.domain);

  // Record the snapshot for the health history / dashboard.
  await admin.from("health_checks").insert({
    workspace_id: d.workspace_id,
    domain_id: d.id,
    check_type: "dns",
    result: { dns, blacklist },
  });

  // Regression = a flag that was true but the record is now DEFINITIVELY absent
  // (false, not null). Flip only the regressed flags; leave unknowns untouched.
  const patch: Record<string, boolean> = {};
  const regressed: string[] = [];
  if (d.dns_spf && dns.spf === false) {
    patch.dns_spf = false;
    regressed.push("SPF");
  }
  if (d.dns_dkim && dns.dkim === false) {
    patch.dns_dkim = false;
    regressed.push("DKIM");
  }
  if (d.dns_dmarc && dns.dmarc === false) {
    patch.dns_dmarc = false;
    regressed.push("DMARC");
  }
  if (regressed.length > 0) {
    result.dnsRegressions += 1;
    await admin.from("sending_domains").update(patch).eq("id", d.id);
    await alert(
      `🚨 DNS regressed for ${d.domain}: ${regressed.join(
        ", ",
      )} no longer found. New sends from this domain are at risk.`,
      { domain: d.domain, workspace_id: d.workspace_id, regressed },
    );
  }

  if (blacklist.length > 0) {
    result.blacklisted += 1;
    await alert(
      `🚨 ${d.domain} is listed on ${blacklist.join(", ")}. Investigate before sending more.`,
      { domain: d.domain, workspace_id: d.workspace_id, blacklist },
    );
  }

  if (d.tracking_domain) {
    const resolves = await hostResolves(d.tracking_domain);
    if (resolves === false) {
      await alert(
        `⚠️ Tracking domain ${d.tracking_domain} for ${d.domain} is not resolving — open/click links will break.`,
        { domain: d.domain, tracking_domain: d.tracking_domain },
      );
    }
  }
}
