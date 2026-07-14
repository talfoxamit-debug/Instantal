import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptToken } from "@/lib/crypto/tokens";
import { refreshAccessToken } from "@/lib/gmail/oauth";
import { GmailSendError, sendGmailMessage } from "@/lib/gmail/send";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildFooter,
  renderTemplate,
  seededPicker,
} from "@/lib/sending/render";
import { gapSatisfied, rampCap, randomGapMs } from "@/lib/sending/ramp";

const CLAIM_BATCH = 100;
const MAX_ATTEMPTS = 3; // initial + 2 retries (Section 5.3)
const RETRY_BACKOFF_MS = 5 * 60_000;
const INBOX_DEFER_MS = 10 * 60_000; // paused/capped inbox: check back later
const LEASE_TTL_MS = 55_000; // shorter than the 1-min cron interval
const STALE_SENDING_MS = 15 * 60_000; // reap rows stuck 'sending' past this

export interface WorkerResult {
  claimed: number;
  sent: number;
  released: number;
  failed: number;
  skipped: number;
}

type Admin = SupabaseClient;

type QueueRow = {
  id: string;
  workspace_id: string;
  campaign_id: string;
  lead_id: string;
  step_id: string | null;
  inbox_id: string | null;
  scheduled_at: string;
  status: string;
  attempts: number;
};

function appUrl(): string {
  const url = process.env.APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!url) {
    // Unsubscribe links are a legal requirement — refuse to send without a
    // base URL rather than ship mail with a broken footer.
    throw new Error("APP_URL (or NEXT_PUBLIC_SITE_URL) is not set.");
  }
  return url.replace(/\/$/, "");
}

export async function runSendWorker(now: Date = new Date()): Promise<WorkerResult> {
  const admin = createAdminClient();
  const result: WorkerResult = {
    claimed: 0,
    sent: 0,
    released: 0,
    failed: 0,
    skipped: 0,
  };

  // Only one tick runs at a time. The per-inbox cap/gap logic reads counters
  // then writes; without this lease two overlapping ticks could both read
  // stale state and exceed the cap / violate the gap. Acquire = conditionally
  // stamp the single lease row only if the current lease has expired.
  const holder = randomUUID();
  const { data: leaseRows } = await admin
    .from("worker_lease")
    .update({
      holder,
      expires_at: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
    })
    .eq("id", 1)
    .lt("expires_at", now.toISOString())
    .select("id");
  if (!leaseRows || leaseRows.length === 0) {
    return result; // another tick holds the lease; skip
  }

  try {
    // Reap rows stranded in 'sending' (a worker that crashed mid-send). Mark
    // them failed, NOT pending — we can't know if the message went out, and
    // re-sending a cold email is worse than dropping one (at-most-once).
    await admin
      .from("send_queue")
      .update({ status: "failed", error: "stale_sending", updated_at: now.toISOString() })
      .eq("status", "sending")
      .lt("updated_at", new Date(now.getTime() - STALE_SENDING_MS).toISOString());

    const { data: claimed, error } = await admin.rpc("claim_due_sends", {
      p_limit: CLAIM_BATCH,
    });
    if (error) throw new Error(`claim_due_sends failed: ${error.message}`);
    const rows = (claimed ?? []) as QueueRow[];
    result.claimed = rows.length;
    if (rows.length === 0) return result;

    // Group by inbox so per-inbox cap/gap can be enforced independently.
    const byInbox = new Map<string | null, QueueRow[]>();
    for (const row of rows) {
      const key = row.inbox_id;
      const list = byInbox.get(key) ?? [];
      list.push(row);
      byInbox.set(key, list);
    }

    for (const [inboxId, group] of byInbox) {
      if (!inboxId) {
        await failRows(admin, group, "no_inbox_assigned", now);
        result.failed += group.length;
        continue;
      }

      const inbox = await loadInbox(admin, inboxId);
      if (!inbox || inbox.status !== "active") {
        await releaseRows(admin, group, now, INBOX_DEFER_MS);
        result.released += group.length;
        continue;
      }

      const cap = rampCap(
        inbox.warmup_started_at ? new Date(inbox.warmup_started_at) : null,
        inbox.daily_cap,
        now,
      );
      const sentToday = await countSentToday(admin, inboxId, now);
      const gapMs = randomGapMs();
      const canSend =
        cap - sentToday > 0 &&
        gapSatisfied(
          inbox.last_send_at ? new Date(inbox.last_send_at) : null,
          now,
          gapMs,
        );

      if (!canSend) {
        await releaseRows(admin, group, now, gapMs);
        result.released += group.length;
        continue;
      }

      // Send at most ONE message per inbox per tick; releasing the rest keeps
      // consecutive sends spaced by at least the gap.
      group.sort((a, b) => (a.scheduled_at < b.scheduled_at ? -1 : 1));
      const [head, ...rest] = group;
      if (rest.length > 0) {
        await releaseRows(admin, rest, now, gapMs);
        result.released += rest.length;
      }

      // A single bad row must not abort the whole tick / strand claimed rows.
      try {
        const outcome = await processOne(admin, head, inbox, now);
        result[outcome] += 1;
      } catch (e) {
        // Unexpected error after the row was claimed: fail it (never auto-retry
        // — we can't prove the message wasn't sent).
        await failRows(
          admin,
          [head],
          `worker_error:${e instanceof Error ? e.message : "err"}`,
          now,
        );
        result.failed += 1;
      }
    }

    return result;
  } finally {
    // Release the lease so the next tick can run immediately.
    await admin
      .from("worker_lease")
      .update({ expires_at: now.toISOString() })
      .eq("id", 1)
      .eq("holder", holder);
  }
}

interface InboxRow {
  id: string;
  workspace_id: string;
  email: string;
  display_name: string | null;
  oauth_refresh_token_enc: string | null;
  daily_cap: number;
  warmup_started_at: string | null;
  last_send_at: string | null;
  status: string;
}

async function loadInbox(admin: Admin, id: string): Promise<InboxRow | null> {
  const { data } = await admin
    .from("inboxes")
    .select(
      "id, workspace_id, email, display_name, oauth_refresh_token_enc, daily_cap, warmup_started_at, last_send_at, status",
    )
    .eq("id", id)
    .maybeSingle();
  return (data as InboxRow) ?? null;
}

async function countSentToday(
  admin: Admin,
  inboxId: string,
  now: Date,
): Promise<number> {
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  const { count } = await admin
    .from("emails")
    .select("*", { count: "exact", head: true })
    .eq("inbox_id", inboxId)
    .gte("sent_at", startOfDay);
  return count ?? 0;
}

async function releaseRows(
  admin: Admin,
  rows: QueueRow[],
  now: Date,
  deferMs: number,
): Promise<void> {
  const at = new Date(now.getTime() + deferMs).toISOString();
  await admin
    .from("send_queue")
    .update({ status: "pending", scheduled_at: at, updated_at: now.toISOString() })
    .in(
      "id",
      rows.map((r) => r.id),
    );
}

async function failRows(
  admin: Admin,
  rows: QueueRow[],
  reason: string,
  now: Date,
): Promise<void> {
  await admin
    .from("send_queue")
    .update({ status: "failed", error: reason, updated_at: now.toISOString() })
    .in(
      "id",
      rows.map((r) => r.id),
    );
}

type Outcome = "sent" | "failed" | "released" | "skipped";

async function processOne(
  admin: Admin,
  row: QueueRow,
  inbox: InboxRow,
  now: Date,
): Promise<Outcome> {
  const ws = row.workspace_id;

  const { data: lead } = await admin
    .from("leads")
    .select("id, email, first_name, last_name, company, title, custom, status")
    .eq("id", row.lead_id)
    .maybeSingle();
  if (!lead) return finalizeFail(admin, row, "lead_missing", now);

  // Defensive suppression re-check: the suppression trigger should already have
  // cancelled this row, but never send to a suppressed address.
  const { data: sup } = await admin
    .from("suppression")
    .select("id")
    .eq("email", lead.email)
    .or(`workspace_id.is.null,workspace_id.eq.${ws}`)
    .limit(1);
  if (sup && sup.length > 0) {
    await admin
      .from("send_queue")
      .update({ status: "cancelled", error: "suppressed", updated_at: now.toISOString() })
      .eq("id", row.id);
    return "skipped";
  }

  if (!row.step_id) return finalizeFail(admin, row, "no_step", now);
  const { data: step } = await admin
    .from("campaign_steps")
    .select("id, step_no, subject, body_text, body_html")
    .eq("id", row.step_id)
    .maybeSingle();
  if (!step) return finalizeFail(admin, row, "step_missing", now);

  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, track_opens")
    .eq("id", row.campaign_id)
    .maybeSingle();

  const { data: workspace } = await admin
    .from("workspaces")
    .select("physical_address")
    .eq("id", ws)
    .maybeSingle();

  // CAN-SPAM requires a physical mailing address in every footer (Section 6).
  // Hard-stop rather than send a non-compliant message — same stance as the
  // missing-unsubscribe-URL guard.
  if (!workspace?.physical_address || !workspace.physical_address.trim()) {
    return finalizeFail(admin, row, "no_physical_address", now);
  }

  const { data: cl } = await admin
    .from("campaign_leads")
    .select("current_step, thread_id, last_message_id")
    .eq("campaign_id", row.campaign_id)
    .eq("lead_id", row.lead_id)
    .maybeSingle();

  if (!inbox.oauth_refresh_token_enc) {
    return finalizeFail(admin, row, "inbox_not_connected", now);
  }

  // Issue (or reuse) the unsubscribe token for the footer + List-Unsubscribe.
  const { data: token, error: tokenErr } = await admin.rpc("ensure_unsub_token", {
    p_workspace_id: ws,
    p_lead_id: row.lead_id,
    p_campaign_id: row.campaign_id,
  });
  if (tokenErr || !token) {
    return retryOrFail(admin, row, "unsub_token_failed", now);
  }
  const base = appUrl();
  const unsubscribeUrl = `${base}/api/unsubscribe/${token}`;

  // Pre-generate the email id so the open-tracking pixel can point at it.
  const emailId = randomUUID();
  const leadData = {
    first_name: lead.first_name,
    last_name: lead.last_name,
    company: lead.company,
    title: lead.title,
    email: lead.email,
    custom: (lead.custom as Record<string, unknown>) ?? {},
  };
  const picker = seededPicker(`${row.lead_id}:${step.id}`);

  const isReply = Boolean(cl?.last_message_id) && step.step_no > 1;
  const baseSubject = renderTemplate(step.subject ?? "", leadData, picker);
  const subject = isReply ? `Re: ${baseSubject}` : baseSubject;

  const bodyText = renderTemplate(step.body_text ?? "", leadData, picker);
  const bodyHtml = step.body_html
    ? renderTemplate(step.body_html, leadData, picker)
    : undefined;

  const trackingPixelUrl =
    campaign?.track_opens && bodyHtml
      ? `${base}/api/track/open/${emailId}`
      : null;
  const footer = buildFooter({
    unsubscribeUrl,
    physicalAddress: workspace?.physical_address,
    trackingPixelUrl,
  });
  const finalText = `${bodyText}${footer.text}`;
  const finalHtml = bodyHtml ? `${bodyHtml}${footer.html}` : undefined;

  // Get a fresh access token, then send.
  let accessToken: string;
  try {
    const refresh = decryptToken(inbox.oauth_refresh_token_enc);
    const refreshed = await refreshAccessToken(refresh);
    accessToken = refreshed.access_token;
  } catch (e) {
    return retryOrFail(
      admin,
      row,
      `token_refresh:${e instanceof Error ? e.message : "err"}`,
      now,
    );
  }

  let sent;
  try {
    sent = await sendGmailMessage(
      accessToken,
      {
        fromName: inbox.display_name ?? undefined,
        fromEmail: inbox.email,
        to: lead.email,
        subject,
        text: finalText,
        html: finalHtml,
        inReplyTo: isReply ? (cl?.last_message_id ?? undefined) : undefined,
        references: isReply ? (cl?.last_message_id ?? undefined) : undefined,
        listUnsubscribeUrl: unsubscribeUrl,
      },
      isReply ? (cl?.thread_id ?? undefined) : undefined,
    );
  } catch (e) {
    // Only retry when Gmail definitively rejected the message (retryable).
    // Network/uncertain failures might have delivered — fail without retry so
    // we never double-send a cold email (at-most-once).
    if (e instanceof GmailSendError && e.retryable) {
      return retryOrFail(admin, row, `gmail_send:${e.message}`, now);
    }
    return finalizeFail(
      admin,
      row,
      `gmail_send_uncertain:${e instanceof Error ? e.message : "err"}`,
      now,
    );
  }

  // SEND SUCCEEDED — from here this row is never retried. Record the email
  // first (unique on campaign,lead,step is the double-send backstop), then
  // mark the queue row terminal. Post-send bookkeeping is best-effort: a
  // failure there must not look like a send failure or trigger a resend.
  const nowIso = now.toISOString();
  const { error: emailErr } = await admin.from("emails").insert({
    id: emailId,
    workspace_id: ws,
    campaign_id: row.campaign_id,
    lead_id: row.lead_id,
    step_id: step.id,
    inbox_id: inbox.id,
    gmail_message_id: sent.id || null,
    gmail_thread_id: sent.threadId || null,
    subject,
    sent_at: nowIso,
  });
  await admin
    .from("send_queue")
    .update({ status: "sent", updated_at: nowIso })
    .eq("id", row.id);
  await admin
    .from("inboxes")
    .update({ last_send_at: nowIso })
    .eq("id", inbox.id);

  // 23505 = this (campaign,lead,step) was already recorded — treat as sent,
  // don't advance again.
  if (!emailErr || emailErr.code !== "23505") {
    await admin.from("events").insert({
      workspace_id: ws,
      email_id: emailId,
      type: "send",
    });
    await advanceSequence(admin, row, inbox.id, step.step_no, sent, now);
  }
  return "sent";
}

// Schedule the lead's next step (if any), or mark the sequence finished.
async function advanceSequence(
  admin: Admin,
  row: QueueRow,
  inboxId: string,
  currentStepNo: number,
  sent: { threadId: string; rfcMessageId?: string },
  now: Date,
): Promise<void> {
  const { data: nextStep } = await admin
    .from("campaign_steps")
    .select("id, step_no, delay_days")
    .eq("campaign_id", row.campaign_id)
    .gt("step_no", currentStepNo)
    .order("step_no", { ascending: true })
    .limit(1)
    .maybeSingle();

  const clBase = {
    workspace_id: row.workspace_id,
    campaign_id: row.campaign_id,
    lead_id: row.lead_id,
    current_step: currentStepNo,
    thread_id: sent.threadId,
    last_message_id: sent.rfcMessageId ?? null,
    updated_at: now.toISOString(),
  };

  if (!nextStep) {
    await admin
      .from("campaign_leads")
      .upsert(
        { ...clBase, status: "finished", next_send_at: null },
        { onConflict: "campaign_id,lead_id" },
      );
    return;
  }

  const nextSendAt = new Date(
    now.getTime() + (nextStep.delay_days as number) * 86_400_000,
  ).toISOString();

  await admin
    .from("campaign_leads")
    .upsert(
      { ...clBase, status: "active", next_send_at: nextSendAt },
      { onConflict: "campaign_id,lead_id" },
    );

  await admin.from("send_queue").insert({
    workspace_id: row.workspace_id,
    campaign_id: row.campaign_id,
    lead_id: row.lead_id,
    step_id: nextStep.id,
    inbox_id: inboxId,
    scheduled_at: nextSendAt,
    status: "pending",
  });
}

async function finalizeFail(
  admin: Admin,
  row: QueueRow,
  reason: string,
  now: Date,
): Promise<Outcome> {
  await admin
    .from("send_queue")
    .update({ status: "failed", error: reason, updated_at: now.toISOString() })
    .eq("id", row.id);
  return "failed";
}

// Retry with backoff until MAX_ATTEMPTS, then give up. Increments attempts
// here (the claim never does), so only genuine failures count.
async function retryOrFail(
  admin: Admin,
  row: QueueRow,
  reason: string,
  now: Date,
): Promise<Outcome> {
  const attempts = row.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await admin
      .from("send_queue")
      .update({
        status: "failed",
        attempts,
        error: reason,
        updated_at: now.toISOString(),
      })
      .eq("id", row.id);
    return "failed";
  }
  await admin
    .from("send_queue")
    .update({
      status: "pending",
      attempts,
      error: reason,
      scheduled_at: new Date(now.getTime() + RETRY_BACKOFF_MS).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", row.id);
  return "released";
}
