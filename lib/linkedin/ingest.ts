import type { SupabaseClient } from "@supabase/supabase-js";

import { getUnipileClient } from "@/lib/unipile/client";

// Ingest inbound LinkedIn replies into the SAME replies table (channel
// 'linkedin') so the existing unified inbox + stop-on-reply trigger + Claude
// classify pass all work unchanged. A reply is matched to a lead via the chat
// id we recorded when we messaged them (linkedin_messages.unipile_chat_id).
// Re-polls a fixed 2-day window; the replies_linkedin_message_key unique index
// makes re-seen messages a no-op, so no per-account cursor is needed.

type Admin = SupabaseClient;
const LOOKBACK_MS = 2 * 86_400_000;

export interface IngestResult {
  accounts: number;
  replies: number;
}

export async function ingestLinkedinReplies(
  admin: Admin,
  now: Date = new Date(),
): Promise<IngestResult> {
  const result: IngestResult = { accounts: 0, replies: 0 };
  const { data: accounts } = await admin
    .from("linkedin_accounts")
    .select("id, workspace_id, unipile_account_id, status")
    .eq("status", "connected")
    .not("unipile_account_id", "is", null);

  const client = getUnipileClient();
  const afterIso = new Date(now.getTime() - LOOKBACK_MS).toISOString();

  for (const account of accounts ?? []) {
    result.accounts += 1;
    let inbound;
    try {
      inbound = await client.listInboundMessages(
        account.unipile_account_id as string,
        afterIso,
      );
    } catch {
      continue; // one account's failure must not stop the rest
    }

    for (const msg of inbound) {
      // Match the chat to a lead via the outbound message we recorded.
      const { data: sent } = await admin
        .from("linkedin_messages")
        .select("lead_id")
        .eq("workspace_id", account.workspace_id)
        .eq("unipile_chat_id", msg.chat_id)
        .not("lead_id", "is", null)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!sent?.lead_id) continue; // reply in a chat we don't track

      const { error } = await admin.from("replies").insert({
        workspace_id: account.workspace_id,
        lead_id: sent.lead_id,
        channel: "linkedin",
        linkedin_account_id: account.id,
        linkedin_chat_id: msg.chat_id,
        linkedin_message_id: msg.message_id,
        body_text: msg.text.slice(0, 20_000),
        received_at: msg.timestamp,
      });
      // 23505 = already ingested (dedup index) — a no-op, not an error.
      if (!error) result.replies += 1;
    }
  }
  return result;
}
