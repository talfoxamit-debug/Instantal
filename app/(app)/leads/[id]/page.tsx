import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { LeadNotes } from "@/components/leads/lead-notes";
import { LeadStageSelect } from "@/components/leads/lead-stage-select";
import { VerifyBadge } from "@/components/leads/lead-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getLead, getLeadTimeline } from "@/lib/leads/data";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();

  const timeline = await getLeadTimeline(id);
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href="/leads">
            <ArrowLeft className="size-4" />
            Back to leads
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              {name || lead.email}
            </h2>
            <p className="text-sm text-muted-foreground">{lead.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <VerifyBadge status={lead.verify_status} />
            <LeadStageSelect leadId={lead.id} stage={lead.owner_stage} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
              <CardDescription>
                Every send, open, click, and reply for this lead. Fills in as
                campaigns run (Phases 2 & 4).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {timeline.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No activity yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {timeline.map((entry) => (
                    <li key={entry.id} className="flex gap-3 text-sm">
                      <span className="mt-1 size-2 shrink-0 rounded-full bg-muted-foreground/50" />
                      <div className="flex flex-col">
                        <span className="font-medium">{entry.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(entry.ts).toLocaleString()}
                        </span>
                        {entry.detail ? (
                          <span className="mt-1 line-clamp-3 text-muted-foreground">
                            {entry.detail}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <LeadNotes leadId={lead.id} initialNotes={lead.notes ?? ""} />
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Detail label="Company" value={lead.company} />
            <Detail label="Title" value={lead.title} />
            <Detail label="Phone" value={lead.phone} />
            <Detail label="Website" value={lead.website} />
            <Detail label="Country" value={lead.country} />
            <Detail label="Source" value={lead.source} />
            {lead.tags.length > 0 ? (
              <div>
                <p className="text-xs text-muted-foreground">Tags</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {lead.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="font-normal">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p>{value || "—"}</p>
    </div>
  );
}
