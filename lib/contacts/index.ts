import { PdlContactSearchProvider } from "@/lib/contacts/pdl";

// Net-new contact SEARCH (roadmap P2a-2) — "find me VPs of Eng at 50-200-person
// SaaS in the US". This is distinct from enrichment (which fills fields on a
// contact you already have): search discovers people you don't have yet.
//
// Like every other external dependency in Instantal, it's behind a provider
// interface so the app stays vendor-agnostic. The concrete provider (People
// Data Labs Person Search by default) is wired in ./pdl; with no key configured
// getContactSearchProvider() returns a no-op that finds nothing, so the UI is
// exercisable and never fabricates people.

export interface ContactSearchFilters {
  titles?: string[]; // job titles / roles
  seniorities?: string[]; // e.g. "vp", "director", "c_suite"
  industries?: string[];
  companySizes?: string[]; // e.g. "51-200"
  locations?: string[]; // countries / regions / cities
  keywords?: string; // free-text
}

export interface FoundContact {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  company: string | null;
  email: string | null; // may be null — search often returns profile w/o email
  linkedin_url: string | null;
  location: string | null;
}

export interface ContactSearchResult {
  contacts: FoundContact[];
  total: number | null; // total matches if the provider reports it
  cursor: string | null; // opaque next-page token, if any
}

export interface ContactSearchProvider {
  readonly name: string;
  search(
    filters: ContactSearchFilters,
    opts?: { size?: number; cursor?: string | null },
  ): Promise<ContactSearchResult>;
}

class NoopContactSearchProvider implements ContactSearchProvider {
  readonly name = "none";
  async search(): Promise<ContactSearchResult> {
    return { contacts: [], total: 0, cursor: null };
  }
}

export function contactSearchConfigured(): boolean {
  return Boolean(process.env.CONTACT_SEARCH_API_KEY);
}

export function getContactSearchProvider(): ContactSearchProvider {
  const apiKey = process.env.CONTACT_SEARCH_API_KEY;
  if (!apiKey) return new NoopContactSearchProvider();
  // PDL is the default; other providers slot in behind the same interface.
  return new PdlContactSearchProvider(apiKey);
}
