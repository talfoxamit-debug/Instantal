import type { Metadata } from "next";

import { ImportWizard } from "@/components/leads/import-wizard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getLeadLists } from "@/lib/leads/data";

export const metadata: Metadata = { title: "Import leads" };

export default async function ImportPage() {
  const lists = await getLeadLists();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import leads from CSV</CardTitle>
        <CardDescription>
          Leads are deduped against existing leads and the suppression list,
          then verified. Suppressed and duplicate rows are skipped — you get a
          full report.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ImportWizard lists={lists} />
      </CardContent>
    </Card>
  );
}
