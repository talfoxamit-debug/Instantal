import { createClient } from "@/lib/supabase/server";
import type { Lead, LeadList } from "@/lib/types";
import { isUuid } from "@/lib/validation";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

export interface LeadFilters {
  search?: string;
  stage?: string;
  verifyStatus?: string;
  listId?: string;
  tag?: string;
}

export interface LeadsPage {
  leads: Lead[];
  count: number;
}

const PAGE_SIZE = 50;

export async function getLeads(
  filters: LeadFilters = {},
  page = 0,
): Promise<LeadsPage> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();

  // Filtering by list needs the lead ids in that list first (list_members is
  // a separate table); everything else filters on leads directly.
  let listLeadIds: string[] | null = null;
  if (filters.listId) {
    const { data } = await supabase
      .from("list_members")
      .select("lead_id")
      .eq("workspace_id", workspaceId)
      .eq("list_id", filters.listId);
    listLeadIds = (data ?? []).map((r) => r.lead_id as string);
    if (listLeadIds.length === 0) return { leads: [], count: 0 };
  }

  let query = supabase
    .from("leads")
    .select("*", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (filters.search) {
    // .or() takes a raw PostgREST filter string; commas and parens are its
    // grammar, so strip them (plus % _ LIKE wildcards) from user input before
    // interpolating. RLS still scopes rows — this is about not corrupting the
    // filter, not tenant isolation.
    const safe = filters.search.replace(/[,()%_*]/g, " ").trim();
    if (safe) {
      const term = `%${safe}%`;
      query = query.or(
        `email.ilike.${term},first_name.ilike.${term},last_name.ilike.${term},company.ilike.${term}`,
      );
    }
  }
  if (filters.stage) query = query.eq("owner_stage", filters.stage);
  if (filters.verifyStatus) query = query.eq("verify_status", filters.verifyStatus);
  if (filters.tag) query = query.contains("tags", [filters.tag]);
  if (listLeadIds) query = query.in("id", listLeadIds);

  const { data, count, error } = await query;
  if (error) throw new Error(`Failed to load leads: ${error.message}`);
  return { leads: (data ?? []) as Lead[], count: count ?? 0 };
}

export async function getLead(id: string): Promise<Lead | null> {
  if (!isUuid(id)) return null; // non-UUID route param -> 404, not a 500
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  return (data as Lead) ?? null;
}

export interface LeadTimelineEntry {
  id: string;
  kind: "email" | "event" | "reply";
  ts: string;
  label: string;
  detail?: string;
}

// Timeline scaffold (Section 5.1): merges the lead's emails, events, and
// replies into one time-ordered stream. Populated as Phases 2/4 land; the
// query shape is here now so the lead detail page renders real data as it
// arrives.
export async function getLeadTimeline(
  leadId: string,
): Promise<LeadTimelineEntry[]> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();

  const [{ data: emails }, { data: replies }] = await Promise.all([
    supabase
      .from("emails")
      .select("id, subject, sent_at, opened_at, first_click_at, bounced")
      .eq("workspace_id", workspaceId)
      .eq("lead_id", leadId),
    supabase
      .from("replies")
      .select("id, body_text, received_at, classification")
      .eq("workspace_id", workspaceId)
      .eq("lead_id", leadId),
  ]);

  const entries: LeadTimelineEntry[] = [];
  for (const e of emails ?? []) {
    if (e.sent_at) {
      entries.push({
        id: `email-${e.id}`,
        kind: "email",
        ts: e.sent_at as string,
        label: `Sent: ${e.subject ?? "(no subject)"}`,
      });
    }
  }
  for (const r of replies ?? []) {
    entries.push({
      id: `reply-${r.id}`,
      kind: "reply",
      ts: r.received_at as string,
      label: `Reply${r.classification ? ` · ${r.classification}` : ""}`,
      detail: (r.body_text as string) ?? undefined,
    });
  }
  entries.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return entries;
}

export async function getLeadLists(): Promise<LeadList[]> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_lists")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("name");
  if (error) throw new Error(`Failed to load lists: ${error.message}`);
  return (data ?? []) as LeadList[];
}

// All distinct tags in the workspace, for the tag filter. Small-N in practice;
// computed from the leads' tags arrays.
export async function getWorkspaceTags(): Promise<string[]> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("tags")
    .eq("workspace_id", workspaceId)
    .not("tags", "eq", "{}");
  const set = new Set<string>();
  for (const row of data ?? []) {
    for (const tag of (row.tags as string[]) ?? []) set.add(tag);
  }
  return Array.from(set).sort();
}
