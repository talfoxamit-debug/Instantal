import Link from "next/link";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { contactSearchConfigured } from "@/lib/contacts";
import { FindLeads } from "@/components/leads/find-leads";

export const metadata = { title: "Find leads" };

export default function FindLeadsPage() {
  const configured = contactSearchConfigured();

  if (!configured) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Find leads</h1>
        <Card className="p-6">
          <Alert className="border-amber-200 bg-amber-50">
            <AlertDescription className="text-amber-900">
              Contact search isn&apos;t set up yet. Add a People Data Labs API key
              (CONTACT_SEARCH_API_KEY) to search for new leads.
            </AlertDescription>
          </Alert>
          <div className="mt-4">
            <Button asChild variant="outline">
              <Link href="/leads">Back to Leads</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Find leads</h1>
      <FindLeads />
    </div>
  );
}
