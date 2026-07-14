"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { removeSuppression } from "@/lib/suppression/actions";
import type { SuppressionEntry } from "@/lib/types";

export function SuppressionTable({ entries }: { entries: SuppressionEntry[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        No suppression entries.
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Added</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell className="font-medium">{entry.email}</TableCell>
              <TableCell>
                {entry.workspace_id === null ? (
                  <Badge variant="secondary">Global</Badge>
                ) : (
                  <Badge variant="outline">Workspace</Badge>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {entry.reason || "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(entry.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isPending}
                  onClick={() => {
                    startTransition(async () => {
                      try {
                        await removeSuppression(entry.id);
                        toast.success("Removed");
                        router.refresh();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Could not remove");
                      }
                    });
                  }}
                >
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
