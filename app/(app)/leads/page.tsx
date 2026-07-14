import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Upload } from "lucide-react";

import { LeadsFilterBar } from "@/components/leads/leads-filter-bar";
import { LeadsTable } from "@/components/leads/leads-table";
import { Button } from "@/components/ui/button";
import {
  getLeadLists,
  getLeads,
  getWorkspaceTags,
  type LeadFilters,
} from "@/lib/leads/data";

export const metadata: Metadata = { title: "Leads" };

const PAGE_SIZE = 50;

// Next 16 gives string[] for repeated query keys (?search=a&search=b); take
// the first so downstream string ops don't crash on an array.
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters: LeadFilters = {
    search: first(sp.search),
    stage: first(sp.stage),
    verifyStatus: first(sp.verify),
    listId: first(sp.list),
    tag: first(sp.tag),
  };
  const page = Math.max(0, Number(first(sp.page) ?? "0") || 0);

  const [{ leads, count }, lists, tags] = await Promise.all([
    getLeads(filters, page),
    getLeadLists(),
    getWorkspaceTags(),
  ]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {count.toLocaleString()} lead{count === 1 ? "" : "s"}
        </p>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/leads/import">
              <Upload className="size-4" />
              Import CSV
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/leads/new">
              <Plus className="size-4" />
              New lead
            </Link>
          </Button>
        </div>
      </div>

      <LeadsFilterBar lists={lists} tags={tags} filters={filters} />

      <LeadsTable leads={leads} lists={lists} />

      {totalPages > 1 ? (
        <Pagination page={page} totalPages={totalPages} params={sp} />
      ) : null}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  params,
}: {
  page: number;
  totalPages: number;
  params: Record<string, string | string[] | undefined>;
}) {
  const build = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      const scalar = first(v);
      if (scalar && k !== "page") q.set(k, scalar);
    }
    q.set("page", String(p));
    return `/leads?${q.toString()}`;
  };
  return (
    <div className="flex items-center justify-between">
      <Button
        asChild
        variant="outline"
        size="sm"
        disabled={page <= 0}
        aria-disabled={page <= 0}
      >
        <Link href={build(Math.max(0, page - 1))}>Previous</Link>
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {page + 1} of {totalPages}
      </span>
      <Button
        asChild
        variant="outline"
        size="sm"
        disabled={page >= totalPages - 1}
        aria-disabled={page >= totalPages - 1}
      >
        <Link href={build(Math.min(totalPages - 1, page + 1))}>Next</Link>
      </Button>
    </div>
  );
}
