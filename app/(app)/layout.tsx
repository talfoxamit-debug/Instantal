import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { createClient } from "@/lib/supabase/server";
import {
  getActiveWorkspace,
  getUserMemberships,
} from "@/lib/workspaces/data";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/login");
  }

  const memberships = await getUserMemberships();
  if (memberships.length === 0) {
    redirect("/onboarding");
  }

  const activeWorkspace = await getActiveWorkspace(memberships);

  return (
    <div className="flex min-h-svh flex-1">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b px-4">
          <WorkspaceSwitcher
            workspaces={memberships.map((m) => ({
              id: m.workspace.id,
              name: m.workspace.name,
              venture: m.workspace.venture,
            }))}
            activeId={activeWorkspace!.id}
          />
          <UserMenu email={String(data.claims.email ?? "")} />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
