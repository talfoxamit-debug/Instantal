import { MembersManager } from "@/components/settings/members-manager";
import {
  getActiveWorkspaceWithRole,
  getWorkspaceMembers,
} from "@/lib/workspaces/data";

export const metadata = { title: "Members" };

export default async function MembersPage() {
  const [wr, members] = await Promise.all([
    getActiveWorkspaceWithRole(),
    getWorkspaceMembers(),
  ]);

  if (!wr) {
    return (
      <div className="text-sm text-muted-foreground">
        No active workspace.
      </div>
    );
  }

  return <MembersManager members={members} canManage={wr.role === "owner"} />;
}
