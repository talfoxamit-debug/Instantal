// Server-free shared types + constants for the reply/inbox/pipeline surface.
// Kept separate from lib/replies/data.ts (which imports the server-only Supabase
// client) so client components can import PIPELINE_STAGES and these types without
// dragging server code — and next/headers — into the browser bundle.

export type ReplyClassificationLabel =
  | "interested"
  | "not_interested"
  | "ooo"
  | "referral"
  | "unsubscribe_request"
  | "bounce"
  | "other";

export interface InboxReply {
  id: string;
  lead_id: string | null;
  lead_name: string | null;
  lead_email: string | null;
  lead_company: string | null;
  lead_stage: string | null;
  body_text: string | null;
  classification: ReplyClassificationLabel | null;
  confidence: number | null;
  handled: boolean;
  received_at: string;
}

export interface InboxFilters {
  classification?: ReplyClassificationLabel;
  handled?: boolean; // omit = all
}

export interface InboxCounts {
  total: number;
  unhandled: number;
  byClassification: Record<string, number>;
}

// Pipeline kanban stages (Section 5.1).
export const PIPELINE_STAGES = [
  "New",
  "Contacted",
  "Replied",
  "Interested",
  "Meeting",
  "Client",
  "Lost",
] as const;

export interface PipelineCard {
  id: string;
  name: string | null;
  email: string;
  company: string | null;
  stage: string;
  updated_at: string;
}
