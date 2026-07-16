import type { Metadata } from "next";

import { LinkedinAccounts } from "@/components/settings/linkedin-accounts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getLinkedinAccounts } from "@/lib/linkedin/data";
import { unipileConfigured } from "@/lib/unipile/client";

export const metadata: Metadata = { title: "LinkedIn" };

export default async function LinkedinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const connected = typeof params.connected === "string" ? params.connected : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;

  const configured = unipileConfigured();
  const accounts = await getLinkedinAccounts();

  return (
    <div className="flex flex-col gap-4 container">
      {connected ? (
        <Alert>
          <AlertDescription>LinkedIn account connected.</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t connect the account — try again.</AlertDescription>
        </Alert>
      ) : null}

      {!configured && (
        <Alert variant="destructive">
          <AlertDescription>
            LinkedIn sending isn&apos;t set up. Add UNIPILE_DSN and UNIPILE_API_KEY to connect accounts.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>LinkedIn accounts</CardTitle>
          <CardDescription>
            Connect a LinkedIn account to send connection requests and messages as steps in a campaign. LinkedIn limits automation, so keep daily caps conservative (≈20 invites / 40 messages per day).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LinkedinAccounts accounts={accounts} configured={configured} />
        </CardContent>
      </Card>
    </div>
  );
}
