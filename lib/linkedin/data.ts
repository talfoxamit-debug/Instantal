import { createClient } from "@/lib/supabase/server";
import { requireActiveWorkspaceId } from "@/lib/workspaces/data";

export interface LinkedinAccountView {
  id: string;
  name: string | null;
  status: string;
  daily_invite_cap: number;
  daily_message_cap: number;
  last_invite_at: string | null;
  last_message_at: string | null;
  last_error: string | null;
}

export async function getLinkedinAccounts(): Promise<LinkedinAccountView[]> {
  const workspaceId = await requireActiveWorkspaceId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("linkedin_accounts")
    .select(
      "id, name, status, daily_invite_cap, daily_message_cap, last_invite_at, last_message_at, last_error",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load LinkedIn accounts: ${error.message}`);
  return (data ?? []) as LinkedinAccountView[];
}
