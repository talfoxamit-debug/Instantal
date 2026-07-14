"use server";

import { revalidatePath } from "next/cache";

import { decryptToken } from "@/lib/crypto/tokens";
import { refreshAccessToken } from "@/lib/gmail/oauth";
import { sendGmailMessage } from "@/lib/gmail/send";
import { createClient } from "@/lib/supabase/server";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

function appUrl(): string {
  const url = process.env.APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!url) throw new Error("APP_URL (or NEXT_PUBLIC_SITE_URL) is not set.");
  return url.replace(/\/$/, "");
}

// Reply to a prospect from inside the app, in the same Gmail thread (Section
// 5.4). Runs under the caller's session (RLS), so every row read here is
// membership-scoped — a user can only reply to their own workspace's threads.
// The sending inbox's refresh token is readable only to workspace members.
export async function sendReply(
  replyId: string,
  bodyText: string,
): Promise<void> {
  const text = bodyText.trim();
  if (!text) throw new Error("Reply body is empty.");
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();

  const { data: reply } = await supabase
    .from("replies")
    .select("id, email_id, lead_id, gmail_message_id")
    .eq("workspace_id", workspaceId)
    .eq("id", replyId)
    .maybeSingle();
  if (!reply?.email_id) throw new Error("Reply not found.");

  const { data: email } = await supabase
    .from("emails")
    .select("id, inbox_id, gmail_thread_id, subject")
    .eq("workspace_id", workspaceId)
    .eq("id", reply.email_id)
    .maybeSingle();
  if (!email?.inbox_id) throw new Error("Original message not found.");

  const { data: lead } = await supabase
    .from("leads")
    .select("id, email, status")
    .eq("workspace_id", workspaceId)
    .eq("id", reply.lead_id)
    .maybeSingle();
  if (!lead?.email) throw new Error("Lead not found.");
  // Never email someone who opted out, even in an existing thread.
  if (["unsubscribed", "suppressed", "bounced"].includes(lead.status)) {
    throw new Error(`Cannot reply: lead is ${lead.status}.`);
  }

  const { data: inbox } = await supabase
    .from("inboxes")
    .select("id, email, display_name, oauth_refresh_token_enc, status")
    .eq("workspace_id", workspaceId)
    .eq("id", email.inbox_id)
    .maybeSingle();
  if (!inbox?.oauth_refresh_token_enc) {
    throw new Error("Sending inbox is not connected.");
  }
  // Don't send from a paused/burned inbox (deliverability + reputation).
  if (inbox.status !== "active") {
    throw new Error(`Sending inbox is ${inbox.status}, not active.`);
  }

  const rawSubject = email.subject ?? "";
  const subject = /^re:/i.test(rawSubject) ? rawSubject : `Re: ${rawSubject}`;

  const refresh = decryptToken(inbox.oauth_refresh_token_enc);
  const { access_token: accessToken } = await refreshAccessToken(refresh);

  // Thread only on a real RFC Message-ID (contains '@'). The stored value can be
  // a bare Gmail internal id when the inbound message had no Message-ID header;
  // that is not a valid In-Reply-To, so we omit it and rely on the Gmail
  // threadId to keep the reply in-thread on our side.
  const threadMessageId =
    reply.gmail_message_id && reply.gmail_message_id.includes("@")
      ? reply.gmail_message_id
      : undefined;

  const sent = await sendGmailMessage(
    accessToken,
    {
      fromName: inbox.display_name ?? undefined,
      fromEmail: inbox.email,
      to: lead.email,
      subject,
      text,
      // Thread the reply to the prospect's message so it lands in the same
      // conversation on their side too.
      inReplyTo: threadMessageId,
      references: threadMessageId,
      // This is a 1:1 human reply, not cold outreach, but List-Unsubscribe is
      // required on the header and harmless here; point at the app root.
      listUnsubscribeUrl: `${appUrl()}/inbox`,
    },
    email.gmail_thread_id ?? undefined,
  );

  // Record the outbound reply for the lead timeline (not a campaign step).
  await supabase.from("emails").insert({
    workspace_id: workspaceId,
    lead_id: lead.id,
    inbox_id: inbox.id,
    gmail_message_id: sent.id || null,
    gmail_thread_id: sent.threadId || email.gmail_thread_id || null,
    subject,
    sent_at: new Date().toISOString(),
  });

  // Mark the inbound reply handled — the operator has responded.
  await supabase
    .from("replies")
    .update({ handled: true })
    .eq("workspace_id", workspaceId)
    .eq("id", replyId);

  revalidatePath("/inbox");
}

// Toggle a reply's handled flag from the inbox UI (mark done / reopen).
export async function setReplyHandled(
  replyId: string,
  handled: boolean,
): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("replies")
    .update({ handled })
    .eq("workspace_id", workspaceId)
    .eq("id", replyId);
  if (error) throw new Error(error.message);
  revalidatePath("/inbox");
}

// Move a lead to a pipeline stage from the inbox/kanban (Section 5.1 stages).
const STAGES = [
  "New",
  "Contacted",
  "Replied",
  "Interested",
  "Meeting",
  "Client",
  "Lost",
] as const;

export async function setLeadStage(
  leadId: string,
  stage: string,
): Promise<void> {
  if (!STAGES.includes(stage as (typeof STAGES)[number])) {
    throw new Error("Invalid pipeline stage.");
  }
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ owner_stage: stage })
    .eq("workspace_id", workspaceId)
    .eq("id", leadId);
  if (error) throw new Error(error.message);
  revalidatePath("/inbox");
  revalidatePath("/pipeline");
}
