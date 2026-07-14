import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptToken } from "@/lib/crypto/tokens";
import { refreshAccessToken } from "@/lib/gmail/oauth";
import {
  getMessage,
  getProfileHistoryId,
  listHistoryMessageIds,
  listRecentMessageIds,
  parseFromAddress,
  type GmailMessage,
} from "@/lib/gmail/read";
import { classifyBounce } from "@/lib/replies/bounce";
import { classifyReply } from "@/lib/replies/classify";
import { createAdminClient } from "@/lib/supabase/admin";

// The reply-worker polls every inbox for new inbound mail (Section 5.4). It runs
// on lease id=2 so it serializes independently of the send-worker (lease id=1):
// two reply ticks must not overlap (they'd double-process the same messages),
// but a reply tick and a send tick are free to run together.
const REPLY_LEASE_ID = 2;
// The reply cron fires every 5 min. A generous lease (4.5 min) gives one tick
// ample headroom to finish so two ticks never overlap and race the poll cursor,
// while still expiring before the next fire if a worker crashes mid-tick.
const LEASE_TTL_MS = 270_000;
const FIRST_POLL_LOOKBACK_MS = 2 * 86_400_000; // first poll only reaches back 2d
const HISTORY_FALLBACK_LOOKBACK_MS = 2 * 86_400_000; // when the cursor expired
const MAX_MESSAGES_PER_INBOX = 150; // cap work per inbox per tick
const CLASSIFY_BATCH = 25; // bounded Claude calls per tick (cost guard)
const CLASSIFY_GIVEUP_MS = 60 * 60_000; // stop retrying an unclassifiable reply

function oooResumeDelayMs(): number {
  const days = Number(process.env.OOO_RESUME_DELAY_DAYS ?? "3");
  return (Number.isFinite(days) && days > 0 ? days : 3) * 86_400_000;
}

export interface ReplyWorkerResult {
  inboxesPolled: number;
  bounces: number;
  replies: number;
  classified: number;
  errors: number;
}

type Admin = SupabaseClient;

interface InboxRow {
  id: string;
  workspace_id: string;
  email: string;
  oauth_refresh_token_enc: string | null;
  status: string;
  last_history_id: string | null;
  last_poll_at: string | null;
}

export async function runReplyWorker(
  now: Date = new Date(),
): Promise<ReplyWorkerResult> {
  const admin = createAdminClient();
  const result: ReplyWorkerResult = {
    inboxesPolled: 0,
    bounces: 0,
    replies: 0,
    classified: 0,
    errors: 0,
  };

  // Serialize reply ticks on lease id=2 (see note above).
  const holder = randomUUID();
  const { data: leaseRows } = await admin
    .from("worker_lease")
    .update({
      holder,
      expires_at: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
    })
    .eq("id", REPLY_LEASE_ID)
    .lt("expires_at", now.toISOString())
    .select("id");
  if (!leaseRows || leaseRows.length === 0) {
    return result; // another reply tick holds the lease; skip
  }

  try {
    const { data: inboxes } = await admin
      .from("inboxes")
      .select(
        "id, workspace_id, email, oauth_refresh_token_enc, status, last_history_id, last_poll_at",
      )
      .eq("status", "active")
      .not("oauth_refresh_token_enc", "is", null);

    for (const inbox of (inboxes ?? []) as InboxRow[]) {
      try {
        const counts = await pollInbox(admin, inbox, now);
        result.bounces += counts.bounces;
        result.replies += counts.replies;
        result.inboxesPolled += 1;
      } catch (e) {
        result.errors += 1;
        // Record the error but DO NOT advance last_poll_at or the cursor: the
        // window this poll failed on must be re-fetched next tick, not skipped.
        await admin
          .from("inboxes")
          .update({
            poll_error: e instanceof Error ? e.message.slice(0, 500) : "poll_error",
          })
          .eq("id", inbox.id);
      }
    }

    // Classify newly-recorded replies in a separate, decoupled pass so a Claude
    // failure never blocks polling and simply retries next tick.
    result.classified = await classifyPendingReplies(admin, now);

    return result;
  } finally {
    await admin
      .from("worker_lease")
      .update({ expires_at: now.toISOString() })
      .eq("id", REPLY_LEASE_ID)
      .eq("holder", holder);
  }
}

interface PollCounts {
  bounces: number;
  replies: number;
}

async function pollInbox(
  admin: Admin,
  inbox: InboxRow,
  now: Date,
): Promise<PollCounts> {
  const counts: PollCounts = { bounces: 0, replies: 0 };
  if (!inbox.oauth_refresh_token_enc) return counts;

  const refresh = decryptToken(inbox.oauth_refresh_token_enc);
  const { access_token: accessToken } = await refreshAccessToken(refresh);

  // Decide the poll strategy. `mode` picks how we resume when we can't drain the
  // whole batch this tick; `completeCursor` is the history id to store ONLY if we
  // process everything.
  let messageIds: string[] = [];
  let mode: "history" | "time" = "time";
  let completeCursor: string | null = inbox.last_history_id;

  if (inbox.last_history_id) {
    const page = await listHistoryMessageIds(accessToken, inbox.last_history_id);
    if (page.historyExpired) {
      // Cursor too old: fall back to a bounded time query and reseed the cursor.
      const afterSec = lookbackSec(inbox.last_poll_at, now, HISTORY_FALLBACK_LOOKBACK_MS);
      messageIds = await listRecentMessageIds(accessToken, afterSec);
      mode = "time";
      completeCursor = await getProfileHistoryId(accessToken);
    } else {
      messageIds = page.ids;
      mode = "history";
      completeCursor = page.newestHistoryId ?? inbox.last_history_id;
    }
  } else {
    // First poll: time query, and seed the history cursor for next time.
    const afterSec = lookbackSec(inbox.last_poll_at, now, FIRST_POLL_LOOKBACK_MS);
    messageIds = await listRecentMessageIds(accessToken, afterSec);
    mode = "time";
    completeCursor = await getProfileHistoryId(accessToken);
  }

  // Fetch metadata and process OLDEST-first (normalizes history-ascending and
  // time-query-descending order). Then, if we couldn't drain the whole batch,
  // advance the cursor only as far as the last message we actually processed —
  // never past unprocessed mail (that would drop it forever).
  const fetched: GmailMessage[] = [];
  for (const id of messageIds) fetched.push(await getMessage(accessToken, id));
  fetched.sort((a, b) => a.internalDate - b.internalDate);

  const capHit = fetched.length > MAX_MESSAGES_PER_INBOX;
  const toProcess = fetched.slice(0, MAX_MESSAGES_PER_INBOX);

  let maxHistory: string | null = null;
  let maxInternalDate = 0;
  for (const msg of toProcess) {
    // Track how far we got BEFORE any skip, so even ignored messages advance the
    // cursor (we've seen them; no need to refetch them).
    maxHistory = maxHistoryId(maxHistory, msg.historyId);
    if (msg.internalDate > maxInternalDate) maxInternalDate = msg.internalDate;

    // Skip our own outbound copies (a threaded send lands in the thread too).
    if (msg.labelIds.includes("SENT") || msg.labelIds.includes("DRAFT")) continue;
    if (msg.labelIds.includes("CHAT")) continue;
    const from = parseFromAddress(msg.fromHeader);
    if (from && from === inbox.email.toLowerCase()) continue;

    await handleMessage(admin, inbox, msg, counts);
  }

  const update: Record<string, unknown> = { poll_error: null };
  if (!capHit) {
    // Drained the batch: advance fully.
    update.last_poll_at = now.toISOString();
    update.last_history_id = completeCursor;
  } else if (mode === "history") {
    // Partial: resume history from the last processed message next tick.
    update.last_history_id = maxHistory ?? inbox.last_history_id;
    update.last_poll_at = now.toISOString();
  } else {
    // Partial on the time path: stay on it, resuming the after: query from the
    // last processed message. Do NOT seed the history cursor until caught up.
    update.last_history_id = null;
    update.last_poll_at = maxInternalDate
      ? new Date(maxInternalDate).toISOString()
      : (inbox.last_poll_at ?? now.toISOString());
  }
  await admin.from("inboxes").update(update).eq("id", inbox.id);

  return counts;
}

// Larger of two Gmail history ids (big integers; compare as BigInt to avoid
// precision loss). Empty/unparseable candidates are ignored.
function maxHistoryId(cur: string | null, cand: string): string | null {
  if (!cand) return cur;
  if (!cur) return cand;
  try {
    return BigInt(cand) > BigInt(cur) ? cand : cur;
  } catch {
    return cur;
  }
}

// Returns true if the message was recognized (bounce or reply), false if it was
// unrelated mail we ignored.
async function handleMessage(
  admin: Admin,
  inbox: InboxRow,
  msg: GmailMessage,
  counts: PollCounts,
): Promise<boolean> {
  const bounce = classifyBounce({
    fromHeader: msg.fromHeader,
    subject: msg.subject,
    bodyText: msg.bodyText,
    failedRecipientsHeader: msg.failedRecipientsHeader,
  });

  if (bounce.isBounce) {
    // Only hard bounces suppress (Section 5.4). Soft bounces are transient — the
    // sequence retries them naturally; we don't act.
    if (bounce.type === "hard" && bounce.recipient) {
      await admin.rpc("record_hard_bounce", {
        p_workspace_id: inbox.workspace_id,
        p_email: bounce.recipient,
        p_inbox_id: inbox.id,
      });
      counts.bounces += 1;
    }
    return true;
  }

  // Genuine reply: match it to the originating send by Gmail thread id.
  if (!msg.threadId) return false;
  const { data: email } = await admin
    .from("emails")
    .select("id, lead_id")
    .eq("workspace_id", inbox.workspace_id)
    .eq("inbox_id", inbox.id)
    .eq("gmail_thread_id", msg.threadId)
    .not("lead_id", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!email) return false; // reply to a thread we don't track

  // Insert the reply. The dedup unique index (workspace_id, gmail_message_id)
  // makes a re-polled message a no-op; the stop-on-reply trigger fires here.
  const { error } = await admin.from("replies").insert({
    workspace_id: inbox.workspace_id,
    email_id: email.id,
    lead_id: email.lead_id,
    gmail_message_id: msg.rfcMessageId || msg.id,
    body_text: msg.bodyText.slice(0, 20_000),
    received_at: new Date(msg.internalDate || Date.now()).toISOString(),
  });
  if (error && error.code !== "23505") {
    throw new Error(`reply insert failed: ${error.message}`);
  }
  if (!error) counts.replies += 1;
  return true;
}

// Classify replies that have no label yet. Bounded per tick so a burst of
// replies can't run up an unbounded Claude bill in one run.
async function classifyPendingReplies(admin: Admin, now: Date): Promise<number> {
  const { data: pending } = await admin
    .from("replies")
    .select("id, body_text, lead_id, received_at")
    .is("classification", null)
    .eq("handled", false)
    .order("received_at", { ascending: true })
    .limit(CLASSIFY_BATCH);

  let classified = 0;
  for (const reply of (pending ?? []) as {
    id: string;
    body_text: string | null;
    lead_id: string | null;
    received_at: string;
  }[]) {
    let label;
    try {
      label = await classifyReply(reply.body_text ?? "");
    } catch {
      // Classification failed (model refusal, truncation, transient API error).
      // Retry on later ticks, but give up after CLASSIFY_GIVEUP_MS and file it
      // as 'other' so it can't be re-picked and re-billed forever.
      const ageMs = now.getTime() - new Date(reply.received_at).getTime();
      if (ageMs > CLASSIFY_GIVEUP_MS) {
        await admin.rpc("apply_reply_classification", {
          p_reply_id: reply.id,
          p_classification: "other",
          p_confidence: 0,
          p_ooo_resume_at: null,
        });
      }
      continue;
    }
    const resumeAt =
      label.classification === "ooo"
        ? new Date(now.getTime() + oooResumeDelayMs()).toISOString()
        : null;
    const { error } = await admin.rpc("apply_reply_classification", {
      p_reply_id: reply.id,
      p_classification: label.classification,
      p_confidence: label.confidence,
      p_ooo_resume_at: resumeAt,
    });
    if (!error) classified += 1;
  }
  return classified;
}

function lookbackSec(
  lastPollAt: string | null,
  now: Date,
  maxLookbackMs: number,
): number {
  const floor = now.getTime() - maxLookbackMs;
  const from = lastPollAt ? new Date(lastPollAt).getTime() : floor;
  // Never reach back further than the cap; always overlap slightly (1 min) so a
  // message that arrived mid-tick isn't missed between polls.
  const chosen = Math.max(floor, from - 60_000);
  return Math.floor(chosen / 1000);
}
