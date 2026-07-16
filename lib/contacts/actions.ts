"use server";

import { revalidatePath } from "next/cache";

import {
  contactSearchConfigured,
  getContactSearchProvider,
  type ContactSearchFilters,
  type ContactSearchResult,
  type FoundContact,
} from "@/lib/contacts";
import {
  enrichmentConfigured,
  getEnrichmentProvider,
} from "@/lib/enrichment";
import { createClient } from "@/lib/supabase/server";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Run a search against the configured contact-data provider. Membership is
// enforced by requireActiveWorkspaceId (this spends provider credits, so it
// must never run for a non-member).
export async function searchContacts(
  filters: ContactSearchFilters,
  cursor?: string | null,
): Promise<ContactSearchResult> {
  await requireActiveWorkspaceId();
  if (!contactSearchConfigured()) {
    throw new Error(
      "No contact-search provider is configured. Set CONTACT_SEARCH_API_KEY (People Data Labs) to enable search.",
    );
  }
  const provider = getContactSearchProvider();
  return provider.search(filters, { size: 25, cursor: cursor ?? null });
}

export interface AddContactsSummary {
  added: number;
  skipped: number; // no email found -> can't become a lead (email is required)
}

// Turn found contacts into leads. Leads require an email, so a contact without
// one is enriched first (if enrichment is configured) to find it; those still
// without an email are skipped and reported. New leads are 'unverified' — the
// launch checklist still blocks sending until they're verified.
export async function addFoundContactsToLeads(
  contacts: FoundContact[],
): Promise<AddContactsSummary> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const canEnrich = enrichmentConfigured();
  const enricher = canEnrich ? getEnrichmentProvider() : null;

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const c of contacts.slice(0, 200)) {
    let email = c.email && EMAIL_RE.test(c.email) ? c.email.toLowerCase() : null;
    if (!email && enricher) {
      const r = await enricher.enrich({
        first_name: c.first_name,
        last_name: c.last_name,
        company: c.company,
      });
      email = r.email;
    }
    if (!email) {
      skipped += 1;
      continue;
    }
    rows.push({
      workspace_id: workspaceId,
      email,
      first_name: c.first_name,
      last_name: c.last_name,
      company: c.company,
      title: c.title,
      country: c.location,
      source: "search",
      custom: c.linkedin_url ? { linkedin_url: c.linkedin_url } : {},
    });
  }

  let added = 0;
  if (rows.length > 0) {
    // Dedupe on (workspace_id, email); an existing lead is left untouched.
    const { data, error } = await supabase
      .from("leads")
      .upsert(rows, { onConflict: "workspace_id,email", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    added = data?.length ?? 0;
  }

  revalidatePath("/leads");
  return { added, skipped };
}
