import type { Metadata } from "next";

import { NewDomainForm } from "@/components/settings/new-domain-form";
import { DomainList } from "@/components/settings/domain-list";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSendingDomains } from "@/lib/inboxes/data";

export const metadata: Metadata = { title: "Sending domains" };

export default async function DomainsPage() {
  const domains = await getSendingDomains();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a sending domain</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <NewDomainForm />
          <p className="text-xs text-muted-foreground">
            Never use a revenue domain. See docs/DNS-SETUP.md for the exact
            SPF/DKIM/DMARC records to publish.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Domains</CardTitle>
        </CardHeader>
        <CardContent>
          <DomainList domains={domains} />
        </CardContent>
      </Card>
    </div>
  );
}
