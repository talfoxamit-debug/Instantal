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
import { deleteSendingDomain } from "@/lib/inboxes/actions";
import type { DomainView } from "@/lib/inboxes/data";

function DNSBadge({
  value,
  label,
}: {
  value: boolean;
  label: string;
}) {
  return (
    <Badge
      variant={value ? "default" : "outline"}
      className="text-xs font-medium"
    >
      {label}
    </Badge>
  );
}

export function DomainList({ domains }: { domains: DomainView[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (domains.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        No sending domains yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Domain</TableHead>
            <TableHead>Tracking</TableHead>
            <TableHead>DNS</TableHead>
            <TableHead>Inboxes</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {domains.map((domain) => (
            <TableRow key={domain.id}>
              <TableCell className="font-medium">{domain.domain}</TableCell>
              <TableCell className="text-muted-foreground">
                {domain.tracking_domain || "—"}
              </TableCell>
              <TableCell>
                <div className="flex gap-1.5">
                  <DNSBadge value={domain.dns_spf} label="SPF" />
                  <DNSBadge value={domain.dns_dkim} label="DKIM" />
                  <DNSBadge value={domain.dns_dmarc} label="DMARC" />
                </div>
              </TableCell>
              <TableCell>{domain.inbox_count}</TableCell>
              <TableCell className="text-right">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isPending}
                  onClick={() => {
                    startTransition(async () => {
                      try {
                        await deleteSendingDomain(domain.id);
                        toast.success("Domain removed");
                        router.refresh();
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : "Could not remove",
                        );
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
