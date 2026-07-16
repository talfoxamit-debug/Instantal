import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CampaignSettings } from "@/components/campaigns/campaign-settings";
import { LaunchPanel } from "@/components/campaigns/launch-panel";
import { StepEditor } from "@/components/campaigns/step-editor";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getCampaign,
  getLaunchChecklist,
  getSampleLead,
} from "@/lib/campaigns/data";
import { getLeadLists } from "@/lib/leads/data";
import { getInboxes } from "@/lib/inboxes/data";
import { getLinkedinAccounts } from "@/lib/linkedin/data";

export const metadata: Metadata = { title: "Campaign" };

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  const [checklist, lists, inboxes, linkedinAccounts, sampleLead] =
    await Promise.all([
      getLaunchChecklist(id),
      getLeadLists(),
      getInboxes(),
      getLinkedinAccounts(),
      getSampleLead(campaign.list_id),
    ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href="/campaigns">
            <ArrowLeft className="size-4" />
            All campaigns
          </Link>
        </Button>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            {campaign.name}
          </h1>
          <span className="text-sm capitalize text-muted-foreground">
            {campaign.status}
          </span>
        </div>
      </div>

      <Tabs defaultValue="steps">
        <TabsList>
          <TabsTrigger value="steps">Sequence</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="launch">Launch</TabsTrigger>
        </TabsList>

        <TabsContent value="steps" className="pt-4">
          <StepEditor
            campaignId={campaign.id}
            steps={campaign.steps}
            sampleLead={sampleLead}
          />
        </TabsContent>

        <TabsContent value="settings" className="pt-4">
          <CampaignSettings
            campaign={campaign}
            lists={lists}
            inboxes={inboxes}
            linkedinAccounts={linkedinAccounts}
          />
        </TabsContent>

        <TabsContent value="launch" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Launch checklist</CardTitle>
              <CardDescription>
                Every required item must be green. The gate protects your domain
                reputation and keeps sends compliant.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LaunchPanel
                campaignId={campaign.id}
                status={campaign.status}
                items={checklist.items}
                passes={checklist.passes}
                eligibleLeadCount={checklist.eligibleLeadCount}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
