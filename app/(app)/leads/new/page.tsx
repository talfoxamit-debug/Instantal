import type { Metadata } from "next";

import { NewLeadForm } from "@/components/leads/new-lead-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "New lead" };

export default function NewLeadPage() {
  return (
    <div className="mx-auto w-full max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>New lead</CardTitle>
          <CardDescription>
            Add a single lead manually. For bulk, use CSV import — it dedupes
            and verifies automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewLeadForm />
        </CardContent>
      </Card>
    </div>
  );
}
