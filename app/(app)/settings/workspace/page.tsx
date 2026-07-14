import { Card } from "@/components/ui/card";
import { WorkspaceSettingsForm } from "@/components/settings/workspace-settings-form";
import { getActiveWorkspaceWithRole } from "@/lib/workspaces/data";

export const metadata = { title: "Workspace settings" };

export default async function WorkspaceSettingsPage() {
  const data = await getActiveWorkspaceWithRole();

  if (!data) {
    return (
      <div className="text-sm text-muted-foreground">
        No active workspace.
      </div>
    );
  }

  return (
    <Card>
      <div className="p-6">
        <WorkspaceSettingsForm
          workspace={data.workspace}
          canEdit={data.role === "owner"}
        />
      </div>
    </Card>
  );
}
