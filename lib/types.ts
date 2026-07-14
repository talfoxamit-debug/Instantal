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
