"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { addSuppressionBulk } from "@/lib/suppression/actions";

// Bulk paste path — how an Instantly blocklist gets loaded (docs/INSTANTLY-MIGRATION.md).
export function SuppressionBulkForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [raw, setRaw] = useState("");
  const [scope, setScope] = useState<"global" | "workspace">("global");

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="bulk-emails">Emails (one per line)</Label>
        <Textarea
          id="bulk-emails"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={"opted-out@example.com\nanother@example.com"}
          rows={6}
        />
      </div>
      <div className="grid gap-2 sm:max-w-xs">
        <Label htmlFor="bulk-scope">Scope</Label>
        <Select
          value={scope}
          onValueChange={(v) => setScope(v as "global" | "workspace")}
        >
          <SelectTrigger id="bulk-scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global">Global — all ventures</SelectItem>
            <SelectItem value="workspace">This workspace only</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end">
        <Button
          disabled={isPending || !raw.trim()}
          onClick={() =>
            startTransition(async () => {
              try {
                const report = await addSuppressionBulk(raw, scope);
                toast.success(
                  `Added ${report.added} · ${report.duplicates} already suppressed · ${report.invalid} invalid`,
                );
                setRaw("");
                router.refresh();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Bulk add failed");
              }
            })
          }
        >
          {isPending ? "Adding…" : "Add all to suppression"}
        </Button>
      </div>
    </div>
  );
}
