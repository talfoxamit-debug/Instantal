"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  searchContacts,
  addFoundContactsToLeads,
} from "@/lib/contacts/actions";
import type {
  ContactSearchFilters,
  FoundContact,
} from "@/lib/contacts";

export function FindLeads() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Filter inputs
  const [titles, setTitles] = useState("");
  const [seniorities, setSeniorities] = useState("");
  const [industries, setIndustries] = useState("");
  const [companySizes, setCompanySizes] = useState("");
  const [locations, setLocations] = useState("");
  const [keywords, setKeywords] = useState("");

  // Results
  const [contacts, setContacts] = useState<FoundContact[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Selection
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const allSelected =
    contacts.length > 0 && selected.size === contacts.length;
  const someSelected = selected.size > 0;

  const selectedContacts = useMemo(() => {
    return Array.from(selected).map((index) => contacts[index]);
  }, [selected, contacts]);

  const parseCommaList = (value: string): string[] => {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  };

  const toggleAll = () => {
    setSelected(
      allSelected ? new Set() : new Set(contacts.map((_, i) => i))
    );
  };

  const toggleOne = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleSearch = () => {
    startTransition(async () => {
      try {
        const filters: ContactSearchFilters = {
          titles: parseCommaList(titles) || undefined,
          seniorities: parseCommaList(seniorities) || undefined,
          industries: parseCommaList(industries) || undefined,
          companySizes: parseCommaList(companySizes) || undefined,
          locations: parseCommaList(locations) || undefined,
          keywords: keywords.trim() || undefined,
        };

        const result = await searchContacts(filters);
        setContacts(result.contacts);
        setTotal(result.total);
        setCursor(result.cursor);
        setSelected(new Set());
        setHasSearched(true);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Search failed");
      }
    });
  };

  const handleLoadMore = () => {
    startTransition(async () => {
      try {
        const filters: ContactSearchFilters = {
          titles: parseCommaList(titles) || undefined,
          seniorities: parseCommaList(seniorities) || undefined,
          industries: parseCommaList(industries) || undefined,
          companySizes: parseCommaList(companySizes) || undefined,
          locations: parseCommaList(locations) || undefined,
          keywords: keywords.trim() || undefined,
        };

        const result = await searchContacts(filters, cursor);
        setContacts((prev) => [...prev, ...result.contacts]);
        setCursor(result.cursor);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Load more failed");
      }
    });
  };

  const handleAddToLeads = () => {
    startTransition(async () => {
      try {
        const result = await addFoundContactsToLeads(selectedContacts);
        setSelected(new Set());
        const skippedMsg = result.skipped
          ? `, ${result.skipped} skipped (no email found)`
          : "";
        toast.success(`Added ${result.added} lead(s)${skippedMsg}`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Action failed");
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Filter Form */}
      <Card className="p-6">
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="titles" className="text-sm font-medium">
                Titles
              </Label>
              <Input
                id="titles"
                placeholder="VP of Engineering, CTO (comma-separated)"
                value={titles}
                onChange={(e) => setTitles(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="seniorities" className="text-sm font-medium">
                Seniorities
              </Label>
              <Input
                id="seniorities"
                placeholder="vp, director, c_suite (comma-separated)"
                value={seniorities}
                onChange={(e) => setSeniorities(e.target.value)}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="industries" className="text-sm font-medium">
                Industries
              </Label>
              <Input
                id="industries"
                placeholder="SaaS, Tech, Finance (comma-separated)"
                value={industries}
                onChange={(e) => setIndustries(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="companySizes" className="text-sm font-medium">
                Company Sizes
              </Label>
              <Input
                id="companySizes"
                placeholder="51-200, 1000+ (comma-separated)"
                value={companySizes}
                onChange={(e) => setCompanySizes(e.target.value)}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="locations" className="text-sm font-medium">
              Locations
            </Label>
            <Input
              id="locations"
              placeholder="San Francisco, US, Remote (comma-separated)"
              value={locations}
              onChange={(e) => setLocations(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="keywords" className="text-sm font-medium">
              Keywords
            </Label>
            <Input
              id="keywords"
              placeholder="Free-text search"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              disabled={isPending}
            />
          </div>

          <Button
            onClick={handleSearch}
            disabled={isPending}
            className="w-full"
          >
            Search
          </Button>
        </div>
      </Card>

      {/* Results */}
      {hasSearched && (
        <>
          {contacts.length > 0 && total !== null && (
            <div className="text-sm text-muted-foreground">
              Showing {contacts.length} of {total} matches
            </div>
          )}

          {contacts.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
              No matches — try broader filters.
            </div>
          ) : (
            <>
              {someSelected && (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
                  <span className="text-sm font-medium">
                    {selected.size} selected
                  </span>
                  <div className="mx-1 h-4 w-px bg-border" />
                  <Button
                    size="sm"
                    disabled={isPending}
                    onClick={handleAddToLeads}
                  >
                    Add to leads
                  </Button>
                </div>
              )}

              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={toggleAll}
                          aria-label="Select all"
                          disabled={isPending}
                        />
                      </TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>LinkedIn</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts.map((contact, index) => (
                      <TableRow
                        key={index}
                        data-state={
                          selected.has(index) ? "selected" : undefined
                        }
                      >
                        <TableCell>
                          <Checkbox
                            checked={selected.has(index)}
                            onCheckedChange={() => toggleOne(index)}
                            aria-label={`Select ${
                              contact.full_name || "contact"
                            }`}
                            disabled={isPending}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {contact.full_name ||
                            [contact.first_name, contact.last_name]
                              .filter(Boolean)
                              .join(" ") ||
                            "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {contact.title || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {contact.company || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {contact.location || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {contact.email ? (
                            <a
                              href={`mailto:${contact.email}`}
                              className="hover:underline"
                            >
                              {contact.email}
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              no email — will enrich
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {contact.linkedin_url ? (
                            <a
                              href={contact.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                            >
                              <span className="text-xs">View</span>
                              <ExternalLink className="size-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {cursor && (
                <Button
                  variant="outline"
                  onClick={handleLoadMore}
                  disabled={isPending}
                  className="w-full"
                >
                  Load more
                </Button>
              )}
            </>
          )}
        </>
      )}

      {!hasSearched && (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Enter filters and search to find new leads.
        </div>
      )}
    </div>
  );
}
