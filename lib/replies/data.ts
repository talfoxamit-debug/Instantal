import { createClient } from "@/lib/supabase/server";
import {
  PIPELINE_STAGES,
  type InboxCounts,
  type InboxFilters,
  type InboxReply,
  type PipelineCard,
  type ReplyClassificationLabel,
} from "@/lib/replies/types";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

// Read layer for the Unified Inbox + pipeline kanban (Section 5.4 / 5.1). All
// queries are membership-scoped via RLS (createClient uses the caller session).
// Shared types + PIPELINE_STAGES live in ./types (server-free) so client
// components can import them without pulling this server module into the bundle.
export {
  PIPELINE_STAGES,
  type InboxCounts,
  type InboxFilters,
  type InboxReply,
  type PipelineCard,
  type ReplyClassificationLabel,
} from "@/lib/replies/types";

const PAGE_SIZE = 50;

export async function listReplies(
  filters: InboxFilters = {},
  page = 0,
): Promise<{ replies: InboxReply[]; count: number }> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();

  let query = supabase
    .from("replies")
    .select(
      "id, lead_id, body_text, classification, confidence, handled, received_at, leads(first_name, last_name, email, company, owner_stage)",
      { count: "exact" },
    )
    .eq("workspace_id", workspaceId)
    .order("received_at", { ascending: false });

  if (filters.classification) {
    query = query.eq("classification", filters.classification);
  }
  if (filters.handled !== undefined) {
    query = query.eq("handled", filters.handled);
  }

  const from = page * PAGE_SIZE;
  query = query.range(from, from + PAGE_SIZE - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(`Failed to load inbox: ${error.message}`);

  const replies: InboxReply[] = (data ?? []).map((r) => {
    // PostgREST embeds a to-one relation as an object, but without generated
    // types it is inferred as an array; normalize either shape.
    const rawLead = (r as unknown as { leads?: LeadJoin | LeadJoin[] | null })
      .leads;
    const lead = Array.isArray(rawLead) ? (rawLead[0] ?? null) : rawLead ?? null;
    return {
      id: r.id as string,
      lead_id: (r.lead_id as string | null) ?? null,
      lead_name: lead ? fullName(lead.first_name, lead.last_name) : null,
      lead_email: lead?.email ?? null,
      lead_company: lead?.company ?? null,
      lead_stage: lead?.owner_stage ?? null,
      body_text: (r.body_text as string | null) ?? null,
      classification: (r.classification as ReplyClassificationLabel | null) ?? null,
      confidence: (r.confidence as number | null) ?? null,
      handled: Boolean(r.handled),
      received_at: r.received_at as string,
    };
  });

  return { replies, count: count ?? 0 };
}

// Counts per classification + unhandled, for the inbox filter chips.
export async function getInboxCounts(): Promise<InboxCounts> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();

  const { data } = await supabase
    .from("replies")
    .select("classification, handled")
    .eq("workspace_id", workspaceId);

  const rows = (data ?? []) as { classification: string | null; handled: boolean }[];
  const byClassification: Record<string, number> = {};
  let unhandled = 0;
  for (const r of rows) {
    if (!r.handled) unhandled += 1;
    const key = r.classification ?? "unclassified";
    byClassification[key] = (byClassification[key] ?? 0) + 1;
  }
  return { total: rows.length, unhandled, byClassification };
}

// Pipeline kanban: leads grouped by stage (Section 5.1).
export async function getPipeline(): Promise<Record<string, PipelineCard[]>> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();

  // Cap per column so a huge workspace doesn't pull every lead into the board.
  const { data, error } = await supabase
    .from("leads")
    .select("id, first_name, last_name, email, company, owner_stage, updated_at")
    .eq("workspace_id", workspaceId)
    .in("owner_stage", PIPELINE_STAGES as unknown as string[])
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`Failed to load pipeline: ${error.message}`);

  const board: Record<string, PipelineCard[]> = {};
  for (const stage of PIPELINE_STAGES) board[stage] = [];
  for (const l of data ?? []) {
    const stage = (l.owner_stage as string) ?? "New";
    (board[stage] ??= []).push({
      id: l.id as string,
      name: fullName(l.first_name as string | null, l.last_name as string | null),
      email: l.email as string,
      company: (l.company as string | null) ?? null,
      stage,
      updated_at: l.updated_at as string,
    });
  }
  return board;
}

interface LeadJoin {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  owner_stage: string | null;
}

function fullName(first: string | null, last: string | null): string | null {
  const name = [first, last].filter(Boolean).join(" ").trim();
  return name || null;
}
