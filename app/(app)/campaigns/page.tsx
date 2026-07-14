import type { Metadata } from "next";
import Link from "next/link";

import { NewCampaignForm } from "@/components/campaigns/new-campaign-form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listCampaigns } from "@/lib/campaigns/data";

export const metadata: Metadata = { title: "Campaigns" };

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  finished: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  archived: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

export default async function CampaignsPage() {
  const campaigns = await listCampaigns();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>

      <Card>
        <CardHeader>
          <CardTitle>New campaign</CardTitle>
        </CardHeader>
        <CardContent>
          <NewCampaignForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All campaigns</CardTitle>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No campaigns yet.
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link
                          href={`/campaigns/${c.id}`}
                          className="font-medium hover:underline"
                        >
                          {c.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[c.status] ?? STATUS_STYLE.draft}`}
                        >
                          {c.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
