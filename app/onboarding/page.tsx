import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WorkspaceForm } from "@/components/workspace-form";
import { getUserMemberships } from "@/lib/workspaces/data";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Create workspace",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const memberships = await getUserMemberships();
  if (memberships.length > 0) {
    redirect("/dashboard");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Create your first workspace</CardTitle>
          <CardDescription>
            One workspace per venture. All leads, campaigns, and inboxes are
            isolated per workspace; add the other ventures later via the
            workspace switcher&apos;s &quot;New workspace&quot; option.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkspaceForm originPath="/onboarding" error={error} />
        </CardContent>
      </Card>
    </main>
  );
}
