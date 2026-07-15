"use server";

import { revalidatePath } from "next/cache";

import {
  deriveDomain,
  enrichmentConfigured,
  getEnrichmentProvider,
} from "@/lib/enrichment";
import { createClient } from "@/lib/supabase/server";
import {
  isWellFormedEmail,
} from "@/lib/verification";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/types";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

const ENRICH_BATCH_LIMIT = 200; // cap per call to bound provider cost/latency

export interface EnrichSummary {
  processed: number;
  enriched: number; // leads that gained at least one field
}

// Fill blank firmographic fields (title, company, website, phone, LinkedIn) on
// existing leads via the configured enrichment provider. Leads already carry an
// email (it's required), so this enriches around it and never overwrites data
// the lead already has. Finding missing emails is a future top-of-funnel
// feature (a contacts-without-email concept the leads table doesn't model yet).
export async function enrichLeads(leadIds: string[]): Promise<EnrichSummary> {
  const workspaceId = await requireActiveWorkspaceId();
  if (!enrichmentConfigured()) {
    throw new Error(
      "No enrichment provider is configured. Set ENRICHMENT_API_URL and ENRICHMENT_API_KEY, then try again.",
    );
  }
  const ids = leadIds.slice(0, ENRICH_BATCH_LIMIT);
  if (ids.length === 0) return { processed: 0, enriched: 0 };

  const supabase = await createClient();
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, email, first_name, last_name, company, title, website, phone, custom")
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  if (error) throw new Error(error.message);

  const provider = getEnrichmentProvider();
  let enriched = 0;

  for (const lead of leads ?? []) {
    const result = await provider.enrich({
      first_name: lead.first_name as string | null,
      last_name: lead.last_name as string | null,
      company: lead.company as string | null,
      email: lead.email as string,
      domain: deriveDomain({
        email: lead.email as string,
        domain: (lead.website as string | null) ?? null,
      }),
    });

    const patch: Record<string, unknown> = {};
    if (!lead.title && result.title) patch.title = result.title;
    if (!lead.company && result.company) patch.company = result.company;
    if (!lead.website && result.website) patch.website = result.website;
    if (!lead.phone && result.phone) patch.phone = result.phone;

    // LinkedIn has no dedicated column — merge into the custom jsonb bag.
    const custom = (lead.custom as Record<string, unknown> | null) ?? {};
    if (result.linkedin_url && !custom.linkedin_url) {
      patch.custom = { ...custom, linkedin_url: result.linkedin_url };
    }

    if (Object.keys(patch).length > 0) {
      await supabase
        .from("leads")
        .update(patch)
        .eq("workspace_id", workspaceId)
        .eq("id", lead.id as string);
      enriched += 1;
    }
  }

  revalidatePath("/leads");
  return { processed: (leads ?? []).length, enriched };
}

// Every action re-resolves the workspace from the caller's session and stamps
// workspace_id explicitly; RLS is the backstop, not the only guard (Next.js
// server actions are POST endpoints reachable outside the UI).

export async function createLead(formData: FormData): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!isWellFormedEmail(email)) {
    throw new Error("A valid email is required.");
  }
  const supabase = await createClient();
  const { error } = await supabase.from("leads").insert({
    workspace_id: workspaceId,
    email,
    first_name: emptyToNull(formData.get("first_name")),
    last_name: emptyToNull(formData.get("last_name")),
    company: emptyToNull(formData.get("company")),
    title: emptyToNull(formData.get("title")),
    phone: emptyToNull(formData.get("phone")),
    website: emptyToNull(formData.get("website")),
    country: emptyToNull(formData.get("country")),
    source: "manual",
  });
  if (error) {
    // Unique violation = duplicate email in this workspace.
    if (error.code === "23505") {
      throw new Error("A lead with this email already exists in this workspace.");
    }
    throw new Error(error.message);
  }
  revalidatePath("/leads");
}

export async function updateLeadStage(
  leadId: string,
  stage: PipelineStage,
): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  if (!PIPELINE_STAGES.includes(stage)) throw new Error("Invalid stage.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ owner_stage: stage })
    .eq("workspace_id", workspaceId)
    .eq("id", leadId);
  if (error) throw new Error(error.message);
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
}

export async function updateLeadNotes(
  leadId: string,
  notes: string,
): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ notes: notes.trim() || null })
    .eq("workspace_id", workspaceId)
    .eq("id", leadId);
  if (error) throw new Error(error.message);
  revalidatePath(`/leads/${leadId}`);
}

export async function deleteLeads(leadIds: string[]): Promise<void> {
  if (leadIds.length === 0) return;
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .delete()
    .eq("workspace_id", workspaceId)
    .in("id", leadIds);
  if (error) throw new Error(error.message);
  revalidatePath("/leads");
}

export async function addLeadsToList(
  leadIds: string[],
  listId: string,
): Promise<void> {
  if (leadIds.length === 0) return;
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const rows = leadIds.map((leadId) => ({
    workspace_id: workspaceId,
    list_id: listId,
    lead_id: leadId,
  }));
  // Ignore rows already in the list (PK conflict) so re-adding is idempotent.
  const { error } = await supabase
    .from("list_members")
    .upsert(rows, { onConflict: "list_id,lead_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  revalidatePath("/leads");
}

export async function tagLeads(
  leadIds: string[],
  tag: string,
): Promise<void> {
  const clean = tag.trim();
  if (leadIds.length === 0 || !clean) return;
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();

  // Atomic dedupe+append in one UPDATE (add_tag_to_leads RPC), so concurrent
  // taggers can't lose each other's writes. RLS on leads still scopes it.
  const { error } = await supabase.rpc("add_tag_to_leads", {
    p_workspace_id: workspaceId,
    p_lead_ids: leadIds,
    p_tag: clean,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/leads");
}

export async function createList(formData: FormData): Promise<void> {
  const workspaceId = await requireActiveWorkspaceId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("List name is required.");
  const supabase = await createClient();
  const { error } = await supabase.from("lead_lists").insert({
    workspace_id: workspaceId,
    name,
    description: emptyToNull(formData.get("description")),
  });
  if (error) {
    if (error.code === "23505") {
      throw new Error("A list with this name already exists.");
    }
    throw new Error(error.message);
  }
  revalidatePath("/leads/lists");
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s || null;
}
