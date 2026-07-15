"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { decryptToken } from "@/lib/crypto/tokens";
import { refreshAccessToken } from "@/lib/gmail/oauth";
import { getMessage, searchMessageIds } from "@/lib/gmail/read";
import { sendGmailMessage } from "@/lib/gmail/send";
import { classifyPlacement, summarize, type Placement } from "@/lib/placement/classify";
import { createClient } from "@/lib/supabase/server";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

const MAX_SEEDS = 25;

function appUrl(): string {
  const url = process.env.APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  return (url ?? "https://localhost").replace(/\/$/, "");
}

// Mark/unmark a connected inbox as a placement SEED. A seed only receives test
// mail, so it's forced to 'paused' and is excluded from sending + health.
export async function setInboxSeed(
  inboxId: string,
  isSeed: boolean,
): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const patch: Record<string, unknown> = { is_seed: isSeed };
  if (isSeed) patch.status = "paused"; // a seed must never send
  const { error } = await supabase
    .from("inboxes")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", inboxId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/placement");
  revalidatePath("/settings/inboxes");
}

// Run a placement test: send a tagged email from `inboxId` to every seed
// mailbox. Reading where each landed happens later in checkPlacementTest (seed
// providers take a minute or two to file the message). Returns the test id.
export async function runPlacementTest(inboxId: string): Promise<string> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();

  const { data: inbox } = await supabase
    .from("inboxes")
    .select("id, email, display_name, oauth_refresh_token_enc, is_seed")
    .eq("workspace_id", workspaceId)
    .eq("id", inboxId)
    .maybeSingle();
  if (!inbox?.oauth_refresh_token_enc) {
    throw new Error("That inbox isn't connected to Google.");
  }
  if (inbox.is_seed) {
    throw new Error("A seed inbox can't send a placement test — pick a sending inbox.");
  }

  const { data: seeds } = await supabase
    .from("inboxes")
    .select("id, email")
    .eq("workspace_id", workspaceId)
    .eq("is_seed", true)
    .limit(MAX_SEEDS);
  const seedRows = seeds ?? [];
  if (seedRows.length === 0) {
    throw new Error(
      "Add at least one seed inbox first (connect a Gmail mailbox and mark it as a seed).",
    );
  }

  const token = `plc-${randomUUID()}`;
  const subject = `Instantal placement check ${token}`;
  const text =
    "This is an automated inbox-placement test from Instantal. " +
    "It confirms where mail from this sender is landing. You can ignore it.";

  const refresh = decryptToken(inbox.oauth_refresh_token_enc);
  const { access_token: accessToken } = await refreshAccessToken(refresh);

  let delivered = 0;
  for (const seed of seedRows) {
    try {
      await sendGmailMessage(accessToken, {
        fromName: inbox.display_name ?? undefined,
        fromEmail: inbox.email,
        to: seed.email as string,
        subject,
        text,
        listUnsubscribeUrl: `${appUrl()}/inbox`,
      });
      delivered += 1;
    } catch {
      // Record the attempt count from what actually sent; a failed seed shows
      // up as "missing" at check time.
    }
  }

  if (delivered === 0) {
    throw new Error("Could not send the test to any seed. Check the sending inbox connection.");
  }

  const { data: test, error } = await supabase
    .from("placement_tests")
    .insert({
      workspace_id: workspaceId,
      inbox_id: inbox.id,
      inbox_email: inbox.email,
      token,
      status: "sent",
      seed_count: seedRows.length,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/settings/placement");
  return test.id as string;
}

// Check a sent test: read each seed mailbox for the token and record where the
// message landed. Safe to run repeatedly (seeds may still be arriving).
export async function checkPlacementTest(testId: string): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();

  const { data: test } = await supabase
    .from("placement_tests")
    .select("id, token")
    .eq("workspace_id", workspaceId)
    .eq("id", testId)
    .maybeSingle();
  if (!test?.token) throw new Error("Placement test not found.");

  const { data: seeds } = await supabase
    .from("inboxes")
    .select("id, email, oauth_refresh_token_enc")
    .eq("workspace_id", workspaceId)
    .eq("is_seed", true)
    .limit(MAX_SEEDS);

  const results: { seed_email: string; placement: Placement }[] = [];
  for (const seed of seeds ?? []) {
    let placement: Placement = "missing";
    if (seed.oauth_refresh_token_enc) {
      try {
        const refresh = decryptToken(seed.oauth_refresh_token_enc as string);
        const { access_token } = await refreshAccessToken(refresh);
        const ids = await searchMessageIds(access_token, `subject:${test.token}`);
        if (ids.length > 0) {
          const msg = await getMessage(access_token, ids[0]);
          placement = classifyPlacement(msg.labelIds);
        }
      } catch {
        placement = "missing";
      }
    }
    results.push({ seed_email: seed.email as string, placement });
  }

  const s = summarize(results);
  const { error } = await supabase
    .from("placement_tests")
    .update({
      status: "complete",
      results,
      seed_count: s.seed_count,
      inbox_count: s.inbox_count,
      promotions_count: s.promotions_count,
      spam_count: s.spam_count,
      missing_count: s.missing_count,
      checked_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", testId);
  if (error) throw new Error(error.message);

  revalidatePath("/settings/placement");
}
