import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { enqueueNextStepRow } from "@/lib/campaigns/advance";
import {
  isWithinWindow,
  nextWindowOpen,
  timeToMinutes,
  type SendWindow,
} from "@/lib/campaigns/schedule";
import {
  latest,
  randomLinkedinGapMs,
  throttleDecision,
  type LinkedinAction,
} from "@/lib/linkedin/throttle";
import { renderTemplate, seededPicker } from "@/lib/sending/render";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUnipileClient, linkedinPublicId } from "@/lib/unipile/client";

// LinkedIn dispatch worker (roadmap P2b). Structurally mirrors the send-worker:
// a single-tick lease (id=3), an atomic FOR UPDATE SKIP LOCKED claim, per-sender
// throttling, one send per account per tick, and at-most-once semantics (a
// LinkedIn action is never auto-retried once dispatched — we can't prove it
// didn't go out, and re-inviting/re-messaging is worse than dropping one).

const LEASE_ID = 3;
const LEASE_TTL_MS = 13 * 60_000; // < the 15-min cron interval
const CLAIM_BATCH = 100;
const STALE_SENDING_MS = 15 * 60_000;
const INBOX_DEFER_MS = 30 * 60_000;

type Admin = SupabaseClient;

interface QueueRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  lead_id: string;
  step_id: string | null;
  linkedin_account_id: string | null;
  scheduled_at: string;
}

export interface LinkedinWorkerResult {
  claimed: number;
  sent: number;
  released: number;
  failed: number;
  skipped: number;
}

export async function runLinkedinWorker(
  now: Date = new Date(),
): Promise<LinkedinWorkerResult> {
  const admin = createAdminClient();
  const result: LinkedinWorkerResult = {
    claimed: 0,
    sent: 0,
    released: 0,
    failed: 0,
    skipped: 0,
  };

  const holder = randomUUID();
  const { data: leaseRows } = await admin
    .from("worker_lease")
    .update({
      holder,
      expires_at: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
    })
    .eq("id", LEASE_ID)
    .lt("expires_at", now.toISOString())
    .select("id");
  if (!leaseRows || leaseRows.length === 0) return result;

  try {
    await admin
      .from("send_queue")
      .update({ status: "failed", error: "stale_sending", updated_at: now.toISOString() })
      .eq("channel", "linkedin")
      .eq("status", "sending")
      .lt("updated_at", new Date(now.getTime() - STALE_SENDING_MS).toISOString());

    const { data: claimed, error } = await admin.rpc("claim_due_linkedin", {
      p_limit: CLAIM_BATCH,
    });
    if (error) throw new Error(`claim_due_linkedin failed: ${error.message}`);
    const rows = (claimed ?? []) as QueueRow[];
    result.claimed = rows.length;
    if (rows.length === 0) return result;

    // Group by LinkedIn account so each account's caps/gap are enforced alone.
    const byAccount = new Map<string | null, QueueRow[]>();
    for (const row of rows) {
      const key = row.linkedin_account_id;
      (byAccount.get(key) ?? byAccount.set(key, []).get(key)!).push(row);
    }

    for (const [accountId, group] of byAccount) {
      if (!accountId) {
        await failRows(admin, group, "no_linkedin_account", now);
        result.failed += group.length;
        continue;
      }
      const account = await loadAccount(admin, accountId);
      if (!account || account.status !== "connected") {
        await releaseRows(admin, group, now, INBOX_DEFER_MS);
        result.released += group.length;
        continue;
      }

      // Send at most one action per account per tick.
      group.sort((a, b) => (a.scheduled_at < b.scheduled_at ? -1 : 1));
      const [head, ...rest] = group;
      const gapMs = randomLinkedinGapMs();
      if (rest.length > 0) {
        await releaseRows(admin, rest, now, gapMs);
        result.released += rest.length;
      }

      try {
        const outcome = await processOne(admin, head, account, now, gapMs);
        result[outcome] += 1;
      } catch (e) {
        await failRows(admin, [head], `worker_error:${e instanceof Error ? e.message : "err"}`, now);
        result.failed += 1;
      }
    }
    return result;
  } finally {
    await admin
      .from("worker_lease")
      .update({ expires_at: now.toISOString() })
      .eq("id", LEASE_ID)
      .eq("holder", holder);
  }
}

interface AccountRow {
  id: string;
  workspace_id: string;
  unipile_account_id: string | null;
  status: string;
  daily_invite_cap: number;
  daily_message_cap: number;
  last_invite_at: string | null;
  last_message_at: string | null;
}

async function loadAccount(admin: Admin, id: string): Promise<AccountRow | null> {
  const { data } = await admin
    .from("linkedin_accounts")
    .select(
      "id, workspace_id, unipile_account_id, status, daily_invite_cap, daily_message_cap, last_invite_at, last_message_at",
    )
    .eq("id", id)
    .maybeSingle();
  return (data as AccountRow) ?? null;
}

type Outcome = "sent" | "failed" | "released" | "skipped";

async function processOne(
  admin: Admin,
  row: QueueRow,
  account: AccountRow,
  now: Date,
  gapMs: number,
): Promise<Outcome> {
  if (!row.step_id) return finalizeFail(admin, row, "no_step", now);
  if (!account.unipile_account_id) {
    return releaseRows(admin, [row], now, INBOX_DEFER_MS).then(() => "released" as const);
  }

  const { data: step } = await admin
    .from("campaign_steps")
    .select("id, step_no, body_text, linkedin_action")
    .eq("id", row.step_id)
    .maybeSingle();
  if (!step) return finalizeFail(admin, row, "step_missing", now);
  const action = (step.linkedin_action as LinkedinAction) ?? "message";

  // Pre-send idempotency: this (campaign,lead,step) already actioned → skip.
  const { data: already } = await admin
    .from("linkedin_messages")
    .select("id")
    .eq("campaign_id", row.campaign_id)
    .eq("lead_id", row.lead_id)
    .eq("step_id", step.id)
    .limit(1);
  if (already && already.length > 0) {
    await admin.from("send_queue").update({ status: "sent", updated_at: now.toISOString() }).eq("id", row.id);
    return "skipped";
  }

  // Respect the campaign's pause + send window at dispatch. A LinkedIn follow-up
  // is scheduled delay_days out and can land off-hours / on an off-day, or after
  // the campaign was paused. Mirror the email worker: cancel if paused (revived on
  // resume), and defer to the next window open if outside business hours.
  const { data: campaign } = await admin
    .from("campaigns")
    .select(
      "status, send_window_start, send_window_end, send_days, timezone_mode, fixed_timezone",
    )
    .eq("id", row.campaign_id)
    .maybeSingle();
  if (campaign) {
    if (campaign.status === "paused") {
      await admin
        .from("send_queue")
        .update({ status: "cancelled", error: "campaign_paused", updated_at: now.toISOString() })
        .eq("id", row.id);
      return "skipped";
    }
    const { data: wsTz } = await admin
      .from("workspaces")
      .select("default_timezone")
      .eq("id", row.workspace_id)
      .maybeSingle();
    const timeZone =
      campaign.timezone_mode === "fixed" && campaign.fixed_timezone
        ? (campaign.fixed_timezone as string)
        : (wsTz?.default_timezone as string) ?? "America/New_York";
    const window: SendWindow = {
      startMinute: timeToMinutes(campaign.send_window_start as string),
      endMinute: timeToMinutes(campaign.send_window_end as string),
      days: (campaign.send_days as number[]) ?? [1, 2, 3, 4, 5],
      timeZone,
    };
    if (!isWithinWindow(now, window)) {
      await releaseRows(admin, [row], now, nextWindowOpen(now, window).getTime() - now.getTime());
      return "released";
    }
  }

  // Throttle: count today's invites/messages for this account and check gap.
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  const [{ count: invitesToday }, { count: messagesToday }] = await Promise.all([
    admin
      .from("linkedin_messages")
      .select("*", { count: "exact", head: true })
      .eq("linkedin_account_id", account.id)
      .eq("action", "connect")
      .gte("sent_at", startOfDay),
    admin
      .from("linkedin_messages")
      .select("*", { count: "exact", head: true })
      .eq("linkedin_account_id", account.id)
      .in("action", ["message", "inmail"])
      .gte("sent_at", startOfDay),
  ]);

  const decision = throttleDecision({
    action,
    dailyInviteCap: account.daily_invite_cap,
    dailyMessageCap: account.daily_message_cap,
    invitesSentToday: invitesToday ?? 0,
    messagesSentToday: messagesToday ?? 0,
    lastActionAt: latest(
      account.last_invite_at ? new Date(account.last_invite_at) : null,
      account.last_message_at ? new Date(account.last_message_at) : null,
    ),
    now,
    gapMs,
  });
  if (!decision.canSend) {
    const defer = decision.reason === "daily_cap" ? INBOX_DEFER_MS : gapMs;
    await releaseRows(admin, [row], now, defer);
    return "released";
  }

  // Resolve the lead's LinkedIn identity.
  const { data: lead } = await admin
    .from("leads")
    .select("id, first_name, last_name, company, title, email, custom, status")
    .eq("id", row.lead_id)
    .maybeSingle();
  if (!lead) return finalizeFail(admin, row, "lead_missing", now);
  if (["unsubscribed", "suppressed", "bounced"].includes(lead.status as string)) {
    await admin.from("send_queue").update({ status: "cancelled", error: "lead_opted_out", updated_at: now.toISOString() }).eq("id", row.id);
    return "skipped";
  }
  const linkedinUrl = (lead.custom as Record<string, unknown> | null)?.linkedin_url as string | undefined;
  const publicId = linkedinPublicId(linkedinUrl);
  if (!publicId) return finalizeFail(admin, row, "no_linkedin_url", now);

  const client = getUnipileClient();
  const profile = await client.resolveProfile(account.unipile_account_id, publicId);
  if (!profile) return finalizeFail(admin, row, "profile_unresolved", now);

  const leadData = {
    first_name: lead.first_name,
    last_name: lead.last_name,
    company: lead.company,
    title: lead.title,
    email: lead.email,
    custom: (lead.custom as Record<string, unknown>) ?? {},
  };
  const picker = seededPicker(`${row.lead_id}:${step.id}`);
  const text = renderTemplate((step.body_text as string) ?? "", leadData, picker);

  // DISPATCH — from here the row is never retried (at-most-once).
  let chatId: string | null = null;
  let messageId: string | null = null;
  try {
    if (action === "connect") {
      await client.sendInvitation(account.unipile_account_id, profile.provider_id, text || undefined);
    } else {
      const sent = await client.sendMessage(account.unipile_account_id, profile.provider_id, text);
      chatId = sent.chat_id;
      messageId = sent.message_id;
    }
  } catch (e) {
    // We cannot prove the action didn't reach LinkedIn → fail without retry.
    return finalizeFail(admin, row, `unipile:${e instanceof Error ? e.message : "err"}`, now);
  }

  const nowIso = now.toISOString();
  await admin.from("linkedin_messages").insert({
    workspace_id: row.workspace_id,
    campaign_id: row.campaign_id,
    lead_id: row.lead_id,
    step_id: step.id,
    linkedin_account_id: account.id,
    action,
    unipile_chat_id: chatId,
    unipile_message_id: messageId,
    sent_at: nowIso,
  });
  await admin.from("send_queue").update({ status: "sent", updated_at: nowIso }).eq("id", row.id);
  await admin
    .from("linkedin_accounts")
    .update(action === "connect" ? { last_invite_at: nowIso } : { last_message_at: nowIso })
    .eq("id", account.id);

  const next = await enqueueNextStepRow(admin, {
    workspaceId: row.workspace_id,
    campaignId: row.campaign_id,
    leadId: row.lead_id,
    currentStepNo: step.step_no as number,
    now,
    currentLinkedinAccountId: account.id,
  });
  // Full lifecycle bookkeeping (parity with the email worker): mark the lead
  // 'finished' when the sequence is done, else 'active' with its next send time —
  // not just current_step, so completed LinkedIn leads don't linger as 'queued'.
  await admin
    .from("campaign_leads")
    .update({
      current_step: step.step_no,
      status: next.finished ? "finished" : "active",
      next_send_at: next.nextSendAt,
      updated_at: nowIso,
    })
    .eq("workspace_id", row.workspace_id)
    .eq("campaign_id", row.campaign_id)
    .eq("lead_id", row.lead_id);

  return "sent";
}

async function releaseRows(admin: Admin, rows: QueueRow[], now: Date, deferMs: number): Promise<void> {
  await admin
    .from("send_queue")
    .update({
      status: "pending",
      scheduled_at: new Date(now.getTime() + deferMs).toISOString(),
      updated_at: now.toISOString(),
    })
    .in("id", rows.map((r) => r.id));
}

async function failRows(admin: Admin, rows: QueueRow[], reason: string, now: Date): Promise<void> {
  await admin
    .from("send_queue")
    .update({ status: "failed", error: reason, updated_at: now.toISOString() })
    .in("id", rows.map((r) => r.id));
}

async function finalizeFail(admin: Admin, row: QueueRow, reason: string, now: Date): Promise<Outcome> {
  await failRows(admin, [row], reason, now);
  return "failed";
}
