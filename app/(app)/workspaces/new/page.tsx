import type { Metadata } from "next";

import { WorkspaceForm } from "@/components/workspace-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "New workspace",
};

export default async function NewWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">New workspace</CardTitle>
          <CardDescription>
            One workspace per venture. Leads, campaigns, and inboxes are
            isolated per workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkspaceForm originPath="/workspaces/new" error={error} />
        </CardContent>
      </Card>
    </div>
  );
}
