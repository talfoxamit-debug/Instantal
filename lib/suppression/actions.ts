"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { isWellFormedEmail } from "@/lib/verification";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

// Add a suppression entry. scope "global" (workspace_id null) propagates the
// opt-out across every venture — the compliant default for an unsubscribe;
// "workspace" limits it to the active workspace. The DB trigger cancels any
// pending sends and marks matching leads suppressed.
export async function addSuppression(formData: FormData): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const scope = String(formData.get("scope") ?? "global");
  const reason = String(formData.get("reason") ?? "manual").trim() || "manual";

  if (!isWellFormedEmail(email)) {
    throw new Error("A valid email is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("suppression").insert({
    workspace_id: scope === "workspace" ? workspaceId : null,
    email,
    reason,
  });
  if (error && error.code !== "23505") {
    // 23505 = already suppressed; treat as success (idempotent opt-out).
    throw new Error(error.message);
  }
  revalidatePath("/leads/suppression");
  revalidatePath("/leads");
}

export interface BulkSuppressionReport {
  added: number;
  duplicates: number;
  invalid: number;
}

// Bulk-add pasted addresses (one per line) — the path for importing an
// Instantly blocklist. Normalizes, validates, dedupes within the input and
// against existing entries at the chosen scope, then inserts the rest.
export async function addSuppressionBulk(
  raw: string,
  scope: "global" | "workspace",
): Promise<BulkSuppressionReport> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();

  const seen = new Set<string>();
  let invalid = 0;
  for (const line of raw.split(/[\r\n,;]+/)) {
    const email = line.trim().toLowerCase();
    if (!email) continue;
    if (!isWellFormedEmail(email)) {
      invalid++;
      continue;
    }
    seen.add(email);
  }
  const emails = Array.from(seen);
  if (emails.length === 0) return { added: 0, duplicates: 0, invalid };

  const targetWorkspace = scope === "workspace" ? workspaceId : null;

  // Skip addresses already suppressed at this exact scope.
  const existing = new Set<string>();
  for (let i = 0; i < emails.length; i += 500) {
    const batch = emails.slice(i, i + 500);
    let q = supabase.from("suppression").select("email").in("email", batch);
    q = targetWorkspace === null
      ? q.is("workspace_id", null)
      : q.eq("workspace_id", targetWorkspace);
    const { data } = await q;
    data?.forEach((r) => existing.add(r.email as string));
  }

  const toInsert = emails.filter((e) => !existing.has(e));
  const duplicates = emails.length - toInsert.length;

  let added = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const batch = toInsert.slice(i, i + 500);
    const rows = batch.map((email) => ({
      workspace_id: targetWorkspace,
      email,
      reason: "instantly_import",
    }));
    // ignoreDuplicates guards against a concurrent racer inserting the same
    // address between our existence check and this insert.
    const { data, error } = await supabase
      .from("suppression")
      .upsert(rows, {
        onConflict: "workspace_id,email",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw new Error(error.message);
    added += data?.length ?? 0;
  }

  revalidatePath("/leads/suppression");
  revalidatePath("/leads");
  return { added, duplicates: duplicates + (toInsert.length - added), invalid };
}

// Owner-only per RLS; a failed delete (member) silently affects 0 rows, so we
// re-check the count is not strictly necessary but we surface DB errors.
export async function removeSuppression(id: string): Promise<void> {
  await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { error } = await supabase.from("suppression").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/leads/suppression");
}
