import type { Metadata } from "next";

import { InboxList } from "@/components/settings/inbox-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getInboxes } from "@/lib/inboxes/data";

export const metadata: Metadata = { title: "Inboxes" };

export default async function InboxesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const connected = typeof params.connected === "string" ? params.connected : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;

  const inboxes = await getInboxes();

  return (
    <div className="flex flex-col gap-4 container">
      {connected ? (
        <Alert>
          <AlertDescription>Connected {connected}.</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Google inboxes</CardTitle>
          <CardDescription>
            Google inboxes that send your cold outreach. Volume ramps
            automatically per the schedule.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InboxList inboxes={inboxes} />
        </CardContent>
      </Card>
    </div>
  );
}
