"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { StageBadge, VerifyBadge } from "@/components/leads/lead-badges";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addLeadsToList,
  deleteLeads,
  tagLeads,
} from "@/lib/leads/actions";
import type { Lead, LeadList } from "@/lib/types";

export function LeadsTable({
  leads,
  lists,
}: {
  leads: Lead[];
  lists: LeadList[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const allSelected = leads.length > 0 && selected.size === leads.length;
  const someSelected = selected.size > 0;

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = (fn: () => Promise<void>, successMsg: string) => {
    startTransition(async () => {
      try {
        await fn();
        setSelected(new Set());
        toast.success(successMsg);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Action failed");
      }
    });
  };

  if (leads.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        No leads match. Import a CSV or add one manually to get started.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {someSelected ? (
        <BulkToolbar
          count={selected.size}
          lists={lists}
          disabled={isPending}
          onDelete={() =>
            run(
              () => deleteLeads(selectedIds),
              `Deleted ${selectedIds.length} lead(s)`,
            )
          }
          onAddToList={(listId) =>
            run(
              () => addLeadsToList(selectedIds, listId),
              `Added to list`,
            )
          }
          onTag={(tag) => run(() => tagLeads(selectedIds, tag), `Tagged`)}
        />
      ) : null}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Verification</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <TableRow key={lead.id} data-state={selected.has(lead.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(lead.id)}
                    onCheckedChange={() => toggleOne(lead.id)}
                    aria-label={`Select ${lead.email}`}
                  />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/leads/${lead.id}`}
                    className="font-medium hover:underline"
                  >
                    {lead.email}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {lead.company || "—"}
                </TableCell>
                <TableCell>
                  <StageBadge stage={lead.owner_stage} />
                </TableCell>
                <TableCell>
                  <VerifyBadge status={lead.verify_status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function BulkToolbar({
  count,
  lists,
  disabled,
  onDelete,
  onAddToList,
  onTag,
}: {
  count: number;
  lists: LeadList[];
  disabled: boolean;
  onDelete: () => void;
  onAddToList: (listId: string) => void;
  onTag: (tag: string) => void;
}) {
  const [tag, setTag] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium">{count} selected</span>
      <div className="mx-1 h-4 w-px bg-border" />

      {lists.length > 0 ? (
        <Select onValueChange={onAddToList} disabled={disabled}>
          <SelectTrigger size="sm" className="w-[160px]">
            <SelectValue placeholder="Add to list…" />
          </SelectTrigger>
          <SelectContent>
            {lists.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled}>
            Tag…
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a tag to {count} lead(s)</DialogTitle>
          </DialogHeader>
          <Input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="e.g. hot-list"
          />
          <DialogFooter>
            <Button
              onClick={() => {
                if (tag.trim()) onTag(tag.trim());
                setTag("");
              }}
              disabled={disabled || !tag.trim()}
            >
              Apply tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button
        variant="destructive"
        size="sm"
        disabled={disabled}
        onClick={onDelete}
        className="ml-auto"
      >
        Delete
      </Button>
    </div>
  );
}
