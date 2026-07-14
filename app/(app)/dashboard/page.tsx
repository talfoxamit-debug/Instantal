import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getInboxHealth } from "@/lib/analytics/data";
import { createClient } from "@/lib/supabase/server";
import {
  getActiveWorkspace,
  getUserMemberships,
} from "@/lib/workspaces/data";

export const metadata: Metadata = {
  title: "Dashboard",
};

// Shown until the workspace has an inbox connected — the manual infra that
// gates real sending. Once inboxes exist the dashboard is all live metrics.
const SETUP_CHECKLIST = [
  "Create your Supabase project and apply the migrations (docs/GO-LIVE.md)",
  "Buy sending domains (variants, never revenue domains) + publish SPF/DKIM/DMARC",
  "Stand up the internal Google OAuth app (docs/SENDING-SETUP.md)",
  "Connect inboxes in Settings and start warmup — the ramp clock starts here",
  "Schedule the workers (pg_cron or Vercel Cron)",
] as const;

export default async function DashboardPage() {
  const memberships = await getUserMemberships();
  const workspace = await getActiveWorkspace(memberships);

  const supabase = await createClient();

  const [leads, verified, suppression, campaigns, inboxHealth] = workspace
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
        supabase.from("suppression").select("*", { count: "exact", head: true }),
        supabase
          .from("campaigns")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspace.id)
          .eq("status", "active"),
        getInboxHealth().catch(() => []),
      ])
    : [null, null, null, null, [] as Awaited<ReturnType<typeof getInboxHealth>>];

  const activeInboxes = inboxHealth.filter((i) => i.status === "active").length;
  const sendsToday = inboxHealth.reduce((s, i) => s + i.sendsToday, 0);
  const showSetup = inboxHealth.length === 0;

  const statCards = [
    { label: "Leads", value: leads?.count ?? 0 },
    { label: "Verified leads", value: verified?.count ?? 0 },
    { label: "Suppression list", value: suppression?.count ?? 0 },
    { label: "Active campaigns", value: campaigns?.count ?? 0 },
    { label: "Active inboxes", value: activeInboxes },
    { label: "Sends today", value: sendsToday },
  ];

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {stat.value.toLocaleString()}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {showSetup ? (
        <Card>
          <CardHeader>
            <CardTitle>Finish setup to start sending</CardTitle>
            <CardDescription>
              The product is ready. These manual infra steps gate real sending —
              full runbook in docs/GO-LIVE.md.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {SETUP_CHECKLIST.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
