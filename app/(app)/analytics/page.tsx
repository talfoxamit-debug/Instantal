import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getDomainHealth,
  getInboxHealth,
  getWorkspaceCampaignStats,
} from "@/lib/analytics/data";

export const metadata: Metadata = { title: "Analytics" };

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

function getStatusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" {
  if (status === "active") return "default";
  if (status === "paused") return "secondary";
  return "destructive";
}

function getWarmupStatusBadgeVariant(
  warmupStatus: string,
): "default" | "outline" {
  return warmupStatus === "completed" ? "default" : "outline";
}

export default async function AnalyticsPage() {
  const [inboxes, domains, campaigns] = await Promise.all([
    getInboxHealth(),
    getDomainHealth(),
    getWorkspaceCampaignStats(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold mb-3">
          Deliverability — Inboxes
        </h2>
        <Card>
          <div className="overflow-x-auto">
            {inboxes.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No inboxes yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Inbox</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Today</TableHead>
                    <TableHead>Bounce 7d</TableHead>
                    <TableHead>Reply 7d</TableHead>
                    <TableHead>Warmup</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inboxes.map((inbox) => (
                    <TableRow key={inbox.inboxId}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{inbox.email}</div>
                          {inbox.pauseReason || inbox.lastError ? (
                            <div className="text-xs text-muted-foreground">
                              {inbox.pauseReason && (
                                <div>Paused: {inbox.pauseReason}</div>
                              )}
                              {inbox.lastError && (
                                <div>Error: {inbox.lastError}</div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(inbox.status)}>
                          {inbox.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {inbox.sendsToday} / {inbox.effectiveCap}
                      </TableCell>
                      <TableCell
                        className={`text-sm ${
                          inbox.bounceRate7d > 0.03
                            ? "bg-destructive/10 text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {pct(inbox.bounceRate7d)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {pct(inbox.replyRate7d)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getWarmupStatusBadgeVariant(
                            inbox.warmupStatus,
                          )}
                        >
                          {inbox.warmupStatus}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Deliverability — Domains</h2>
        <Card>
          <div className="overflow-x-auto">
            {domains.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No domains yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>DNS</TableHead>
                    <TableHead>Bounce 7d</TableHead>
                    <TableHead>Sent 7d</TableHead>
                    <TableHead>Bounces</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domains.map((domain) => (
                    <TableRow key={domain.domainId}>
                      <TableCell className="font-medium">
                        {domain.domain}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getStatusBadgeVariant(domain.status)}
                        >
                          {domain.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Badge
                            variant={domain.dnsSpf ? "default" : "outline"}
                            className="text-[10px]"
                          >
                            SPF
                          </Badge>
                          <Badge
                            variant={domain.dnsDkim ? "default" : "outline"}
                            className="text-[10px]"
                          >
                            DKIM
                          </Badge>
                          <Badge
                            variant={domain.dnsDmarc ? "default" : "outline"}
                            className="text-[10px]"
                          >
                            DMARC
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell
                        className={`text-sm ${
                          domain.bounceRate7d > 0.05
                            ? "bg-destructive/10 text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {pct(domain.bounceRate7d)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {domain.sent7d}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {domain.bounceCount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Campaign performance</h2>
        <Card>
          <div className="overflow-x-auto">
            {campaigns.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No campaigns yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead>Delivered</TableHead>
                    <TableHead>Bounced</TableHead>
                    <TableHead>Replies</TableHead>
                    <TableHead>Positive</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((campaign) => (
                    <TableRow key={campaign.campaignId}>
                      <TableCell>
                        <Link
                          href={`/analytics/${campaign.campaignId}`}
                          className="font-medium hover:underline"
                        >
                          {campaign.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getStatusBadgeVariant(campaign.status)}
                        >
                          {campaign.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {campaign.sent}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {campaign.delivered}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {pct(campaign.bounceRate)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {pct(campaign.replyRate)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {campaign.positive} ({pct(campaign.positiveRate)})
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
