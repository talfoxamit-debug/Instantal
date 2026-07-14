import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import {
  getActiveWorkspace,
  getUserMemberships,
} from "@/lib/workspaces/data";

export const metadata: Metadata = {
  title: "Dashboard",
};

const PHASE_0_CHECKLIST = [
  "Buy 2 sending domains (variants, never revenue domains)",
  "Create 4 Google Workspace inboxes (2 per domain)",
  "Publish SPF, DKIM, DMARC + tracking CNAMEs (docs/DNS-SETUP.md)",
  "Verify every domain in Google Postmaster Tools",
  "Domain aging clock running - no real sends before day 10-14",
] as const;

export default async function DashboardPage() {
  const memberships = await getUserMemberships();
  const workspace = await getActiveWorkspace(memberships);

  // Live counts where the data exists; later-phase metrics stay phase-badged.
  const supabase = await createClient();
  const [{ count: leadCount }, { count: verifiedCount }, { count: suppressionCount }] =
    workspace
      ? await Promise.all([
          supabase
            .from("leads")
            .select("*", { count: "exact", head: true })
            .eq("workspace_id", workspace.id),
          supabase
            .from("leads")
            .select("*", { count: "exact", head: true })
            .eq("workspace_id", workspace.id)
            .eq("verify_status", "valid"),
          supabase
            .from("suppression")
            .select("*", { count: "exact", head: true }),
        ])
      : [{ count: 0 }, { count: 0 }, { count: 0 }];

  const statCards = [
    { label: "Leads", value: leadCount ?? 0 },
    { label: "Verified leads", value: verifiedCount ?? 0 },
    { label: "Suppression list", value: suppressionCount ?? 0 },
    { label: "Active campaigns", value: 0, phase: "Phase 3" },
  ] as const;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {workspace?.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {workspace?.venture} · {workspace?.default_timezone}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {stat.value.toLocaleString()}
              </CardTitle>
            </CardHeader>
            {"phase" in stat && stat.phase ? (
              <CardContent>
                <Badge variant="outline">{stat.phase}</Badge>
              </CardContent>
            ) : null}
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Phase 0 - Infrastructure checklist</CardTitle>
          <CardDescription>
            Code is live; the manual infrastructure steps below are what gate
            real sending. Full instructions: docs/PHASE-0-CHECKLIST.md and
            docs/DNS-SETUP.md in the repo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm">
            {PHASE_0_CHECKLIST.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                {item}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
