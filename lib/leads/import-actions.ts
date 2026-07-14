"use server";

import { revalidatePath } from "next/cache";

import {
  buildCandidates,
  classifyCandidates,
  parseCsv,
  type ColumnMapping,
} from "@/lib/import/csv";
import { createClient } from "@/lib/supabase/server";
import type { ImportReport } from "@/lib/types";
import { getVerificationProvider } from "@/lib/verification";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

export interface ImportLeadsInput {
  csvText: string;
  mapping: ColumnMapping;
  listId?: string | null;
  source?: string;
  verify: boolean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function importLeads(
  input: ImportLeadsInput,
): Promise<ImportReport> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();

  if (!input.mapping.email) {
    throw new Error("An email column mapping is required.");
  }

  const parsed = parseCsv(input.csvText);
  const candidates = buildCandidates(parsed, input.mapping);
  const emails = Array.from(
    new Set(candidates.map((c) => c.email).filter(Boolean)),
  );

  // Existing leads in this workspace (RLS already scopes, workspace filter is
  // belt-and-suspenders) and suppression entries (global + workspace) that
  // match any candidate email. Chunked so a huge IN list can't blow up.
  const existingEmails = new Set<string>();
  const suppressedEmails = new Set<string>();
  for (const batch of chunk(emails, 500)) {
    const [{ data: leadRows }, { data: supRows }] = await Promise.all([
      supabase
        .from("leads")
        .select("email")
        .eq("workspace_id", workspaceId)
        .in("email", batch),
      supabase.from("suppression").select("email").in("email", batch),
    ]);
    leadRows?.forEach((r) => existingEmails.add(r.email as string));
    supRows?.forEach((r) => suppressedEmails.add(r.email as string));
  }

  const { accepted, report } = classifyCandidates(
    candidates,
    existingEmails,
    suppressedEmails,
  );

  if (accepted.length === 0) return report;

  // Insert accepted leads. verify_status starts 'pending' when verification
  // is on, else 'unverified'. A partial insert failure surfaces as an error
  // rather than a silently short import.
  const verifyOn = input.verify;
  const insertedIds: string[] = [];
  for (const batch of chunk(accepted, 500)) {
    const rows = batch.map((c) => ({
      workspace_id: workspaceId,
      email: c.email,
      first_name: c.first_name ?? null,
      last_name: c.last_name ?? null,
      company: c.company ?? null,
      title: c.title ?? null,
      phone: c.phone ?? null,
      website: c.website ?? null,
      country: c.country ?? null,
      custom: c.custom,
      source: input.source ?? "csv_import",
      verify_status: verifyOn ? "pending" : "unverified",
    }));
    const { data, error } = await supabase
      .from("leads")
      .insert(rows)
      .select("id");
    if (error) {
      throw new Error(`Import failed while inserting leads: ${error.message}`);
    }
    data?.forEach((r) => insertedIds.push(r.id as string));
  }

  // Attach to a target list if requested.
  if (input.listId) {
    for (const batch of chunk(insertedIds, 500)) {
      const rows = batch.map((leadId) => ({
        workspace_id: workspaceId,
        list_id: input.listId!,
        lead_id: leadId,
      }));
      const { error } = await supabase.from("list_members").insert(rows);
      if (error) {
        throw new Error(`Import: adding leads to list failed: ${error.message}`);
      }
    }
  }

  // Verify accepted addresses and write results back, grouped by status.
  if (verifyOn) {
    const provider = getVerificationProvider();
    const acceptedEmails = accepted.map((c) => c.email);
    const byStatus = new Map<string, string[]>();
    for (const batch of chunk(acceptedEmails, 200)) {
      const results = await provider.verify(batch);
      for (const r of results) {
        const list = byStatus.get(r.status) ?? [];
        list.push(r.email);
        byStatus.set(r.status, list);
      }
    }
    const checkedAt = new Date().toISOString();
    for (const [status, statusEmails] of byStatus) {
      for (const batch of chunk(statusEmails, 500)) {
        await supabase
          .from("leads")
          .update({ verify_status: status, verify_checked_at: checkedAt })
          .eq("workspace_id", workspaceId)
          .in("email", batch);
      }
    }
  }

  revalidatePath("/leads");
  return report;
}
