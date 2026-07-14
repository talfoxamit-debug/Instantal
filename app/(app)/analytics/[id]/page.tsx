import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCampaignVariantStats, type VariantStat } from "@/lib/analytics/data";

export const metadata: Metadata = { title: "Campaign analytics" };

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

export default async function CampaignAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const variants = await getCampaignVariantStats(id);

  // Group by step and find winner in each step
  const stepGroups = new Map<number, VariantStat[]>();
  for (const v of variants) {
    if (!stepGroups.has(v.stepNo)) {
      stepGroups.set(v.stepNo, []);
    }
    stepGroups.get(v.stepNo)!.push(v);
  }

  const winnersByStep = new Map<number, string>();
  for (const [stepNo, rows] of stepGroups.entries()) {
    if (rows.length > 1) {
      // Find winner: highest positiveRate, but only if sent > 0
      const validRows = rows.filter((r) => r.sent > 0);
      if (validRows.length > 0) {
        const winner = validRows.reduce((max, r) =>
          r.positiveRate > max.positiveRate ? r : max,
        );
        winnersByStep.set(stepNo, winner.variantGroup);
      }
    }
  }

  const sortedVariants = variants.sort((a, b) => {
    if (a.stepNo !== b.stepNo) return a.stepNo - b.stepNo;
    return a.variantGroup.localeCompare(b.variantGroup);
  });

  return (
    <div className="flex flex-col gap-4">
      <Button asChild variant="outline" className="w-fit">
        <Link href="/analytics">Back to analytics</Link>
      </Button>

      <Card>
        <div className="overflow-x-auto">
          {sortedVariants.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No sends yet for this campaign.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Step</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead>Bounced</TableHead>
                  <TableHead>Replies</TableHead>
                  <TableHead>Positive</TableHead>
                  <TableHead>Positive rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedVariants.map((variant) => {
                  const isWinner =
                    winnersByStep.get(variant.stepNo) === variant.variantGroup;
                  return (
                    <TableRow
                      key={`${variant.stepNo}-${variant.variantGroup}`}
                      className={isWinner ? "bg-muted/40" : ""}
                    >
                      <TableCell className="font-medium">
                        {variant.stepNo}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{variant.variantGroup}</span>
                          {isWinner && <Badge variant="default">Winner</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {variant.sent}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {variant.delivered}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {variant.bounced}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {pct(variant.replyRate)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {variant.positive}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {pct(variant.positiveRate)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}
