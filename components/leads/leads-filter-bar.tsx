"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LeadFilters } from "@/lib/leads/data";
import { PIPELINE_STAGES, VERIFY_STATUSES, type LeadList } from "@/lib/types";

const ANY = "__any__";

export function LeadsFilterBar({
  lists,
  tags,
  filters,
}: {
  lists: LeadList[];
  tags: string[];
  filters: LeadFilters;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(filters.search ?? "");

  const apply = (next: Partial<LeadFilters>) => {
    const merged = { ...filters, ...next };
    const q = new URLSearchParams();
    if (merged.search) q.set("search", merged.search);
    if (merged.stage) q.set("stage", merged.stage);
    if (merged.verifyStatus) q.set("verify", merged.verifyStatus);
    if (merged.listId) q.set("list", merged.listId);
    if (merged.tag) q.set("tag", merged.tag);
    startTransition(() => router.push(`/leads?${q.toString()}`));
  };

  const hasFilters =
    filters.search ||
    filters.stage ||
    filters.verifyStatus ||
    filters.listId ||
    filters.tag;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply({ search });
        }}
        className="relative"
      >
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, company"
          className="w-64 pl-8"
        />
      </form>

      <FilterSelect
        placeholder="Stage"
        value={filters.stage}
        options={PIPELINE_STAGES.map((s) => ({ value: s, label: s }))}
        onChange={(v) => apply({ stage: v })}
      />
      <FilterSelect
        placeholder="Verification"
        value={filters.verifyStatus}
        options={VERIFY_STATUSES.map((s) => ({ value: s, label: s }))}
        onChange={(v) => apply({ verifyStatus: v })}
      />
      <FilterSelect
        placeholder="List"
        value={filters.listId}
        options={lists.map((l) => ({ value: l.id, label: l.name }))}
        onChange={(v) => apply({ listId: v })}
      />
      {tags.length > 0 ? (
        <FilterSelect
          placeholder="Tag"
          value={filters.tag}
          options={tags.map((t) => ({ value: t, label: t }))}
          onChange={(v) => apply({ tag: v })}
        />
      ) : null}

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setSearch("");
            startTransition(() => router.push("/leads"));
          }}
        >
          <X className="size-4" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}

function FilterSelect({
  placeholder,
  value,
  options,
  onChange,
}: {
  placeholder: string;
  value?: string;
  options: { value: string; label: string }[];
  onChange: (value?: string) => void;
}) {
  return (
    <Select
      value={value ?? ANY}
      onValueChange={(v) => onChange(v === ANY ? undefined : v)}
    >
      <SelectTrigger size="sm" className="w-[150px] capitalize">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>All {placeholder.toLowerCase()}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="capitalize">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
