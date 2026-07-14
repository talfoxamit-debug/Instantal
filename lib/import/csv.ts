// Pure CSV → lead-candidate logic for the import wizard. No Supabase here so
// it can be unit-tested in isolation; the server action in
// lib/leads/import-actions.ts supplies the existing-email and suppression sets.

import Papa from "papaparse";

import { isWellFormedEmail } from "@/lib/verification";
import type { ImportReport, LeadImportField } from "@/lib/types";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

// Map from a lead field (or "custom:Key") to the CSV column header it reads.
export type ColumnMapping = Partial<Record<LeadImportField, string>> & {
  custom?: Record<string, string>;
};

export interface LeadCandidate {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  title?: string;
  phone?: string;
  website?: string;
  country?: string;
  custom: Record<string, string>;
}

export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const headers = result.meta.fields?.map((f) => f.trim()) ?? [];
  return { headers, rows: result.data };
}

const SIMPLE_FIELDS: LeadImportField[] = [
  "email",
  "first_name",
  "last_name",
  "company",
  "title",
  "phone",
  "website",
  "country",
];

// Build lead candidates from parsed rows + a column mapping. Emails are
// normalized (lower/trim) so downstream dedup/suppression matching lines up
// with the DB's normalize_email trigger.
export function buildCandidates(
  parsed: ParsedCsv,
  mapping: ColumnMapping,
): LeadCandidate[] {
  return parsed.rows.map((row) => {
    const candidate: LeadCandidate = { email: "", custom: {} };
    for (const field of SIMPLE_FIELDS) {
      const col = mapping[field];
      if (col && row[col] != null) {
        const value = String(row[col]).trim();
        if (value) candidate[field] = value;
      }
    }
    candidate.email = (candidate.email ?? "").toLowerCase().trim();
    if (mapping.custom) {
      for (const [key, col] of Object.entries(mapping.custom)) {
        const value = row[col] != null ? String(row[col]).trim() : "";
        if (value) candidate.custom[key] = value;
      }
    }
    return candidate;
  });
}

export interface ClassifiedImport {
  accepted: LeadCandidate[];
  report: ImportReport;
}

// Partition candidates into accepted vs. rejected buckets, in this order:
//   1. malformed / missing email  -> invalid
//   2. duplicate within the file  -> duplicates (first wins)
//   3. already a lead in workspace -> duplicates
//   4. on the suppression list     -> suppressed
// Suppression is checked last so a suppressed address is never silently
// inserted; existing-lead dedup runs before it so re-importing a known lead
// counts as a duplicate, not a suppression hit.
export function classifyCandidates(
  candidates: LeadCandidate[],
  existingEmails: Set<string>,
  suppressedEmails: Set<string>,
): ClassifiedImport {
  const accepted: LeadCandidate[] = [];
  const seenInFile = new Set<string>();
  const invalidSamples: string[] = [];
  let duplicates = 0;
  let invalid = 0;
  let suppressed = 0;

  for (const candidate of candidates) {
    const email = candidate.email;
    if (!email || !isWellFormedEmail(email)) {
      invalid++;
      if (invalidSamples.length < 10) invalidSamples.push(email || "(blank)");
      continue;
    }
    if (seenInFile.has(email) || existingEmails.has(email)) {
      duplicates++;
      continue;
    }
    if (suppressedEmails.has(email)) {
      suppressed++;
      seenInFile.add(email);
      continue;
    }
    seenInFile.add(email);
    accepted.push(candidate);
  }

  return {
    accepted,
    report: {
      total: candidates.length,
      accepted: accepted.length,
      duplicates,
      invalid,
      suppressed,
      invalidSamples,
    },
  };
}
