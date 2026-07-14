export type WorkspaceRole = "owner" | "member";

export interface Workspace {
  id: string;
  name: string;
  venture: string;
  physical_address: string | null;
  default_timezone: string;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  role: WorkspaceRole;
  workspace: Workspace;
}

// --- CRM entities (Phase 1) ------------------------------------------------

export const PIPELINE_STAGES = [
  "New",
  "Contacted",
  "Replied",
  "Interested",
  "Meeting",
  "Client",
  "Lost",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const VERIFY_STATUSES = [
  "unverified",
  "pending",
  "valid",
  "invalid",
  "risky",
  "unknown",
] as const;
export type VerifyStatus = (typeof VERIFY_STATUSES)[number];

export const LEAD_STATUSES = [
  "active",
  "unsubscribed",
  "bounced",
  "suppressed",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface Lead {
  id: string;
  workspace_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  phone: string | null;
  website: string | null;
  country: string | null;
  custom: Record<string, unknown>;
  tags: string[];
  source: string | null;
  verify_status: VerifyStatus;
  verify_checked_at: string | null;
  status: LeadStatus;
  owner_stage: PipelineStage;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadList {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface SuppressionEntry {
  id: string;
  workspace_id: string | null;
  email: string;
  reason: string;
  created_at: string;
}

// Fields a CSV column can map to. `custom.*` is handled separately.
export const LEAD_IMPORT_FIELDS = [
  "email",
  "first_name",
  "last_name",
  "company",
  "title",
  "phone",
  "website",
  "country",
] as const;
export type LeadImportField = (typeof LEAD_IMPORT_FIELDS)[number];

export interface ImportReport {
  total: number;
  accepted: number;
  duplicates: number;
  invalid: number;
  suppressed: number;
  invalidSamples: string[];
}

// One workspace per venture (OUTREACH-BUILD-PLAN.md Section 1).
export const VENTURES = ["FoxStays", "Seatop", "Octo"] as const;

export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Jerusalem",
  "Europe/London",
  "UTC",
] as const;
