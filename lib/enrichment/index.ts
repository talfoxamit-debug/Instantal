// Lead enrichment: fill missing fields on a lead — most importantly the EMAIL
// for a lead you only have a name + company for — plus firmographic data
// (title, website, LinkedIn). This mirrors lib/verification: the app stays
// provider-agnostic and calls getEnrichmentProvider(); the concrete vendor is
// wired when chosen (FindyMail / LeadMagic / Apollo / Hunter / …).
//
// "Waterfall": the leaders cascade across several providers and stop at the
// first hit. This module models that with an ordered list of providers — the
// first that returns an email wins, and firmographic fields merge across all.
//
// With no vendor configured it falls back to a NO-OP provider that finds
// nothing — enrichment must never fabricate an email, since a made-up address
// would sail into the send path. A found email is written back as `unverified`
// so it is re-checked before it can ever be sent (Section 5.1).

export interface EnrichmentInput {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  domain?: string | null; // company domain, if known
  email?: string | null; // already-known email (used to enrich firmographics)
}

export interface EnrichmentResult {
  email: string | null;
  title: string | null;
  company: string | null;
  website: string | null;
  linkedin_url: string | null;
  phone: string | null;
  provider: string; // which provider produced the hit ("none" if no match)
}

const EMPTY: Omit<EnrichmentResult, "provider"> = {
  email: null,
  title: null,
  company: null,
  website: null,
  linkedin_url: null,
  phone: null,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function wellFormed(email: string | null | undefined): boolean {
  return !!email && EMAIL_RE.test(email.trim());
}

export interface EnrichmentProvider {
  readonly name: string;
  enrich(input: EnrichmentInput): Promise<EnrichmentResult>;
}

// Default when no vendor is configured. Finds nothing — never invents data.
class NoopEnrichmentProvider implements EnrichmentProvider {
  readonly name = "none";
  async enrich(): Promise<EnrichmentResult> {
    return { ...EMPTY, provider: "none" };
  }
}

// Vendor scaffold. Vendors differ; map the concrete request/response when the
// vendor is chosen and set ENRICHMENT_API_URL + ENRICHMENT_API_KEY. The shape
// below is a common POST {first_name,last_name,company,domain} -> {email,...}.
class HttpEnrichmentProvider implements EnrichmentProvider {
  readonly name: string;
  private readonly apiUrl: string;
  private readonly apiKey: string;
  constructor(apiUrl: string, apiKey: string, name = "http") {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.name = name;
  }

  async enrich(input: EnrichmentInput): Promise<EnrichmentResult> {
    try {
      const res = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          first_name: input.first_name ?? undefined,
          last_name: input.last_name ?? undefined,
          company: input.company ?? undefined,
          domain: input.domain ?? undefined,
        }),
      });
      if (!res.ok) return { ...EMPTY, provider: this.name };
      const body = (await res.json()) as Record<string, unknown>;
      // Common field names; adjust to the chosen vendor's response.
      const email = str(body.email);
      return {
        email: wellFormed(email) ? email!.toLowerCase() : null,
        title: str(body.title ?? body.job_title),
        company: str(body.company ?? body.organization),
        website: str(body.website ?? body.domain),
        linkedin_url: str(body.linkedin_url ?? body.linkedin),
        phone: str(body.phone),
        provider: this.name,
      };
    } catch {
      return { ...EMPTY, provider: this.name };
    }
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// The waterfall: try each provider in order. First email hit wins; firmographic
// fields are merged (first non-null across providers). Stops early once an
// email is found to avoid spending further credits.
export class WaterfallEnrichmentProvider implements EnrichmentProvider {
  readonly name = "waterfall";
  private readonly providers: EnrichmentProvider[];
  constructor(providers: EnrichmentProvider[]) {
    this.providers = providers;
  }

  async enrich(input: EnrichmentInput): Promise<EnrichmentResult> {
    const merged: EnrichmentResult = { ...EMPTY, provider: "none" };
    for (const provider of this.providers) {
      const r = await provider.enrich(input);
      merged.title ??= r.title;
      merged.company ??= r.company;
      merged.website ??= r.website;
      merged.linkedin_url ??= r.linkedin_url;
      merged.phone ??= r.phone;
      if (!merged.email && r.email) {
        merged.email = r.email;
        merged.provider = r.provider;
        break; // email found — stop the waterfall
      }
    }
    return merged;
  }
}

// Resolve the configured enrichment provider. Supports a single HTTP vendor
// today; the waterfall wrapper is ready for multiple once more are wired.
export function getEnrichmentProvider(): EnrichmentProvider {
  const apiKey = process.env.ENRICHMENT_API_KEY;
  const apiUrl = process.env.ENRICHMENT_API_URL;
  if (apiKey && apiUrl) {
    return new WaterfallEnrichmentProvider([
      new HttpEnrichmentProvider(apiUrl, apiKey),
    ]);
  }
  return new NoopEnrichmentProvider();
}

export function enrichmentConfigured(): boolean {
  return Boolean(process.env.ENRICHMENT_API_KEY && process.env.ENRICHMENT_API_URL);
}

// Derive a company domain from a website URL or email, for providers that key
// off the domain. Pure helper, exported for the enrich action + tests.
export function deriveDomain(input: EnrichmentInput): string | null {
  if (input.domain) return input.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (input.email && input.email.includes("@")) {
    return input.email.split("@")[1].toLowerCase();
  }
  return null;
}
