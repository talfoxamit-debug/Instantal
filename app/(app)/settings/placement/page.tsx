import type { Metadata } from "next";

import { PlacementView } from "@/components/settings/placement-view";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getPlacementTests,
  getSeedInboxes,
  getSenderInboxOptions,
} from "@/lib/placement/data";

export const metadata: Metadata = { title: "Deliverability test" };

export default async function PlacementPage() {
  const [seeds, senders, tests] = await Promise.all([
    getSeedInboxes(),
    getSenderInboxOptions(),
    getPlacementTests(),
  ]);

  return (
    <div className="flex flex-col gap-4 container">
      <Card>
        <CardHeader>
          <CardTitle>Inbox placement testing</CardTitle>
          <CardDescription>
            Send a test email from one of your inboxes to seed mailboxes, then check where it
            landed — inbox, promotions, or spam. Wait 1–2 minutes after sending before checking.
          </CardDescription>
        </CardHeader>
      </Card>

      <PlacementView seeds={seeds} senders={senders} tests={tests} />
    </div>
  );
}
