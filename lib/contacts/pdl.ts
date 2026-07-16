import type {
  ContactSearchFilters,
  ContactSearchProvider,
  ContactSearchResult,
  FoundContact,
} from "@/lib/contacts";

// People Data Labs Person Search adapter. Translates our filter set into PDL's
// Elasticsearch bool query, calls POST /v5/person/search, and maps records to
// FoundContact. Verify the exact field/endpoint names against PDL's current
// docs before going live; the shape below follows their v5 Person Search API.
//
// Cost note: PDL charges one credit per matched record returned, so `size` is
// the spend knob — keep it modest (the UI defaults to 25).

const PDL_SEARCH_URL = "https://api.peopledatalabs.com/v5/person/search";

interface PdlPerson {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  job_company_name?: string;
  work_email?: string;
  recommended_personal_email?: string;
  linkedin_url?: string;
  location_name?: string;
}

export class PdlContactSearchProvider implements ContactSearchProvider {
  readonly name = "pdl";
  private readonly apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(
    filters: ContactSearchFilters,
    opts: { size?: number; cursor?: string | null } = {},
  ): Promise<ContactSearchResult> {
    const must: unknown[] = [];
    const addTerms = (field: string, values?: string[]) => {
      if (values && values.length > 0) {
        must.push({ terms: { [field]: values.map((v) => v.toLowerCase()) } });
      }
    };
    // Titles use a match (partial) rather than exact terms.
    if (filters.titles && filters.titles.length > 0) {
      must.push({
        bool: {
          should: filters.titles.map((t) => ({ match: { job_title: t } })),
          minimum_should_match: 1,
        },
      });
    }
    addTerms("job_title_levels", filters.seniorities);
    addTerms("industry", filters.industries);
    addTerms("job_company_size", filters.companySizes);
    // A location value may be a country, region, or city — match any of PDL's
    // location fields so "Berlin", "California", and "US" all resolve. A bare
    // location_country term would silently return zero for anything but a country.
    if (filters.locations && filters.locations.length > 0) {
      must.push({
        bool: {
          should: filters.locations.flatMap((loc) => {
            const v = loc.toLowerCase();
            return [
              { term: { location_country: v } },
              { term: { location_region: v } },
              { term: { location_locality: v } },
            ];
          }),
          minimum_should_match: 1,
        },
      });
    }
    if (filters.keywords && filters.keywords.trim()) {
      must.push({ query_string: { query: filters.keywords.trim() } });
    }

    const size = Math.min(Math.max(opts.size ?? 25, 1), 100);
    const body: Record<string, unknown> = {
      query: { bool: { must } },
      size,
    };
    if (opts.cursor) body.scroll_token = opts.cursor;

    const res = await fetch(PDL_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": this.apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Contact search failed (${res.status}). ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      data?: PdlPerson[];
      total?: number;
      scroll_token?: string;
    };

    const contacts: FoundContact[] = (json.data ?? []).map((p) => ({
      full_name: p.full_name ?? null,
      first_name: p.first_name ?? null,
      last_name: p.last_name ?? null,
      title: p.job_title ?? null,
      company: p.job_company_name ?? null,
      email: p.work_email ?? p.recommended_personal_email ?? null,
      linkedin_url: p.linkedin_url ?? null,
      location: p.location_name ?? null,
    }));

    return {
      contacts,
      total: typeof json.total === "number" ? json.total : null,
      cursor: json.scroll_token ?? null,
    };
  }
}
