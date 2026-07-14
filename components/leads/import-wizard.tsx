"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseCsv, type ColumnMapping } from "@/lib/import/csv";
import { importLeads } from "@/lib/leads/import-actions";
import {
  LEAD_IMPORT_FIELDS,
  type ImportReport,
  type LeadImportField,
  type LeadList,
} from "@/lib/types";

const FIELD_LABELS: Record<LeadImportField, string> = {
  email: "Email (required)",
  first_name: "First name",
  last_name: "Last name",
  company: "Company",
  title: "Title",
  phone: "Phone",
  website: "Website",
  country: "Country",
};

const NONE = "__none__";

type Step = "upload" | "map" | "report";

export function ImportWizard({ lists }: { lists: LeadList[] }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState<Partial<Record<LeadImportField, string>>>({});
  const [listId, setListId] = useState<string>(NONE);
  const [verify, setVerify] = useState(true);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [isPending, startTransition] = useTransition();

  const onFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      toast.error("Could not read any rows from that file.");
      return;
    }
    // Best-effort auto-map by header name.
    const auto: Partial<Record<LeadImportField, string>> = {};
    for (const field of LEAD_IMPORT_FIELDS) {
      const match = parsed.headers.find(
        (h) => h.toLowerCase().replace(/[\s_-]/g, "") === field.replace(/_/g, ""),
      );
      if (match) auto[field] = match;
    }
    if (!auto.email) {
      const emailish = parsed.headers.find((h) => /e-?mail/i.test(h));
      if (emailish) auto.email = emailish;
    }
    setCsvText(text);
    setHeaders(parsed.headers);
    setRowCount(parsed.rows.length);
    setMapping(auto);
    setStep("map");
  };

  const submit = () => {
    if (!mapping.email) {
      toast.error("Map a column to Email before importing.");
      return;
    }
    const fullMapping: ColumnMapping = { ...mapping };
    startTransition(async () => {
      try {
        const result = await importLeads({
          csvText,
          mapping: fullMapping,
          listId: listId === NONE ? null : listId,
          verify,
        });
        setReport(result);
        setStep("report");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Import failed");
      }
    });
  };

  if (step === "upload") {
    return (
      <div className="flex flex-col gap-4">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center hover:bg-accent/40">
          <span className="text-sm font-medium">Choose a CSV file</span>
          <span className="text-xs text-muted-foreground">
            One row per lead. An email column is required.
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
        </label>
      </div>
    );
  }

  if (step === "map") {
    return (
      <div className="flex flex-col gap-6">
        <p className="text-sm text-muted-foreground">
          {rowCount.toLocaleString()} rows found. Map your CSV columns to lead
          fields. Unmapped columns are ignored.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {LEAD_IMPORT_FIELDS.map((field) => (
            <div key={field} className="grid gap-1.5">
              <Label>{FIELD_LABELS[field]}</Label>
              <Select
                value={mapping[field] ?? NONE}
                onValueChange={(v) =>
                  setMapping((prev) => ({
                    ...prev,
                    [field]: v === NONE ? undefined : v,
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Not mapped" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not mapped</SelectItem>
                  {headers.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Add to list (optional)</Label>
            <Select value={listId} onValueChange={setListId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="No list" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No list</SelectItem>
                {lists.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2">
            <Checkbox
              checked={verify}
              onCheckedChange={(c) => setVerify(c === true)}
            />
            <span className="text-sm">
              Verify emails on import (recommended)
            </span>
          </label>
        </div>

        <div className="flex justify-between">
          <Button variant="ghost" onClick={() => setStep("upload")}>
            Back
          </Button>
          <Button onClick={submit} disabled={isPending || !mapping.email}>
            {isPending ? "Importing…" : `Import ${rowCount.toLocaleString()} rows`}
          </Button>
        </div>
      </div>
    );
  }

  // report
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Total" value={report?.total ?? 0} />
        <Stat label="Accepted" value={report?.accepted ?? 0} tone="good" />
        <Stat label="Duplicates" value={report?.duplicates ?? 0} />
        <Stat label="Invalid" value={report?.invalid ?? 0} tone="warn" />
        <Stat label="Suppressed" value={report?.suppressed ?? 0} tone="warn" />
      </div>
      {report && report.invalidSamples.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="mb-1 font-medium">Examples of rejected emails</p>
          <p className="text-muted-foreground">
            {report.invalidSamples.join(", ")}
          </p>
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setStep("upload");
            setReport(null);
            setCsvText("");
            setMapping({});
          }}
        >
          Import another file
        </Button>
        <Button onClick={() => router.push("/leads")}>View leads</Button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "warn";
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          tone === "good"
            ? "text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
            : tone === "warn"
              ? "text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400"
              : "text-2xl font-semibold tabular-nums"
        }
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}
