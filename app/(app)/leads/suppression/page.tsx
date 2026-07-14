import type { Metadata } from "next";

import { SuppressionAddForm } from "@/components/leads/suppression-add-form";
import { SuppressionBulkForm } from "@/components/leads/suppression-bulk-form";
import { SuppressionTable } from "@/components/leads/suppression-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSuppression } from "@/lib/suppression/data";

export const metadata: Metadata = { title: "Suppression" };

export default async function SuppressionPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const rawSearch = searchParams.search;
  const search = Array.isArray(rawSearch) ? rawSearch[0] : rawSearch;
  const { entries, count } = await getSuppression(search ?? "");

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add suppression</CardTitle>
          <CardDescription>
            Add a single address, or paste an Instantly blocklist in bulk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="single">
            <TabsList>
              <TabsTrigger value="single">Single</TabsTrigger>
              <TabsTrigger value="bulk">Bulk paste</TabsTrigger>
            </TabsList>
            <TabsContent value="single" className="pt-4">
              <SuppressionAddForm />
            </TabsContent>
            <TabsContent value="bulk" className="pt-4">
              <SuppressionBulkForm />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Suppression list</CardTitle>
          <CardDescription>
            Suppressed addresses are never emailed, across every venture for global entries.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="text-sm text-muted-foreground">
            {count} {count === 1 ? "entry" : "entries"}
          </div>
          <SuppressionTable entries={entries} />
        </CardContent>
      </Card>
    </div>
  );
}
